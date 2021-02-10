/* eslint-disable no-useless-escape */
import path from 'path';
import fs from 'fs-extra';
import namehash from 'eth-ens-namehash';
import slash from 'slash';

export type SPA2IPFSOptions = {
  routes: string[] | (() => string[]);
  folderPath: string;
  targetFolderPath?: string;
  serviceWorker?: string;
  useBaseElem?: boolean;
  ethLinkErrorRedirect?: {redirectTo: 'ipns' | 'hash', nodeURL: string};
  applicationFilePath?: string;
  injectDebugConsole?: boolean;
};

type Manifest = {
  inputs: Record<string, {
    imports: {path: string; kind: string}[];
    bytes: number;
  }>;
  outputs: Record<string, {
    imports: {path: string, kind: string}[];
    exports: string[];
    inputs: Record<string, {bytesInOutput: number}>;
    bytes: number;
  }>;
}

let logFunc: (msg: string) => void = (msg) => console.log(msg);

// from: https://stackoverflow.com/a/17886301
function escapeRegExp(stringToGoIntoTheRegex: string): string {
  return stringToGoIntoTheRegex.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function print(message: string) {
  process.stdout.write(message);
}

function insertTopOfHead(indexHtml: string, content: string): string {
  let scriptStart = indexHtml.indexOf('<!--SCRIPTS-->');
  if (scriptStart === -1) {
    // TODO const regex = /<meta .*charset=.*(>)/;
    scriptStart = indexHtml.indexOf('<head>') + 6;
  } else {
    scriptStart += 14;
  }
  indexHtml = indexHtml.slice(0, scriptStart) + content + indexHtml.slice(scriptStart);
  return indexHtml;
}

async function generatePages(indexHtml: string, routes: string[], options: SPA2IPFSOptions, manifest?: Manifest) {
  const exportFolder = options.targetFolderPath || options.folderPath;
  logFunc('generating pages and rebasing path relative...');
  const template = indexHtml;
  const findSrc = 'src="/';
  const reSrc = new RegExp(findSrc, 'g');
  const findHref = 'href="/';
  const reHref = new RegExp(findHref, 'g');
  const findContent = 'content="/';
  const reContent = new RegExp(findContent, 'g');
  const findRelpath = 'window.relpath="/';
  const reRelpath = new RegExp(findRelpath, 'g');

  if (manifest) {
    const files: {
      path: string;
      regex: RegExp;
    }[] = []
    let fileInfos: Record<string, any> = manifest.outputs;
    // if (!fileInfos) {
    //   fileInfos = manifest.inputs;
    // }
    if (fileInfos) {// TODO better do not transform if already relative path ?
      logFunc(`replacing absolute url with relative url...`);
      for (const fileKey of Object.keys(fileInfos)) {
        files.push({
          path: fileKey,
          regex:new RegExp(fileKey, 'g')
        })
      }
      for (const fileKey of Object.keys(fileInfos)) {
        const startWithSlash = fileKey.startsWith("/");
        const filepath = startWithSlash ? fileKey.slice(1) : fileKey;
        const fromAssetPath = path.join(options.folderPath, filepath);
        const assetPath = path.join(exportFolder, filepath);
        let input = fs.readFileSync(fromAssetPath).toString();
        for (const file of files) {
          if (file.path === fileKey) {
            continue;
          }
          const relativePath = "./" + slash(path.relative(path.dirname(fileKey), file.path));
          // logFunc({relativePath, fileKey, path: file.path});
          input = input.replace(file.regex, relativePath)
        }
        fs.writeFileSync(assetPath, input);
      }
    }
  }

  
  for (const page of routes) {
    if (page.endsWith('.*')) {
      continue;
    }
    const folderPath = path.join(exportFolder, page);
    const indexFilepath = path.join(folderPath, 'index.html');
    // logFunc({indexFilepath});
    const numSlashes = page.split('/').length - 1;
    let baseHref = '';
    if (page != '') {
      baseHref = '../';
      for (let i = 0; i < numSlashes; i++) {
        baseHref += '../';
      }
    }

    let indexHtml = template;

    let srcBaseHref = baseHref;
    if (options.useBaseElem) {
      if (baseHref !== '') {
        const baseElem = `
    <base href="${baseHref}">
`;
        indexHtml = insertTopOfHead(indexHtml, baseElem);
      }
      srcBaseHref = '';
    }

    indexHtml = indexHtml
      .replace(reSrc, 'src="' + srcBaseHref)
      .replace(reSrc, 'src="' + srcBaseHref)
      .replace(reHref, 'href="' + srcBaseHref)
      .replace(reContent, 'content="' + srcBaseHref);

    indexHtml = indexHtml.replace(reRelpath, 'window.relpath="' + baseHref);

    if (options.injectDebugConsole) {
      fs.ensureDirSync(path.join(exportFolder, 'scripts'));
      fs.copyFileSync(path.join(__dirname, 'scripts', 'eruda.js'), path.join(exportFolder, 'scripts', 'eruda.js'));
      const debugScripts = `
    <script>
      (function () {
        if (!!/\\?_d_eruda/.test(window.location) || !!/&_d_eruda/.test(window.location)) {
          var src = '${srcBaseHref}scripts/eruda.js';
          window._debug = true;
          document.write('<scr' + 'ipt src="' + src + '"></scr' + 'ipt>');
          document.write('<scr' + 'ipt>eruda.init();</scr' + 'ipt>');
        }
      })();
    </script>
`;
      indexHtml = insertTopOfHead(indexHtml, debugScripts);
    }



    fs.ensureDirSync(folderPath);
    fs.writeFileSync(indexFilepath, indexHtml);
  }

  const findGeneric = '"/';
  const reGeneric = new RegExp(findGeneric, 'g');
  for (const filename of [
    'yandex-browser-manifest.json',
    'manifest.webapp',
    'manifest.json',
    'browserconfig.xml',
  ]) {
    if (filename) {
      const filepath = path.join(exportFolder, filename);
      if (fs.existsSync(filepath)) {
        fs.writeFileSync(
          filepath,
          fs.readFileSync(filepath).toString().replace(reGeneric, '"./')
        );
      }
    }
  }
  // print(' done');
}

function generateCacheURLs(
  exportFolder: string,
  subFolders: string[],
  filter?: (p: string) => boolean
) {
  if (!filter) {
    filter = () => true;
  }
  let bundleFiles: string[] = [];
  for (const subFolder of subFolders) {
    bundleFiles = bundleFiles.concat(
      fs
        .readdirSync(path.join(exportFolder, subFolder))
        .filter(filter)
        .map((v) => `${subFolder}${subFolder !== '' ? '/' : ''}${v}`)
    );
  }
  return bundleFiles;
}

function generateServiceWorker(routes: string[], options: SPA2IPFSOptions, manifest?: Manifest) {
  const serviceWorkerFileName = options.serviceWorker || 'sw.js';
  const exportFolder = options.targetFolderPath || options.folderPath;
  logFunc('generating service worker...');

  const precache: string[] = [];
  if (manifest) {
    let fileInfos: Record<string, any> = manifest.outputs;
    if (!fileInfos) {
        fileInfos = manifest.inputs;
    }
    for (const fileKey of Object.keys(fileInfos)) {
      const startWithSlash = fileKey.startsWith("/");
      precache.push(startWithSlash ? fileKey.slice(1): fileKey);
    }
  }

  let sw: string | undefined;
  try {
    sw  = fs.readFileSync(path.join(options.folderPath, serviceWorkerFileName)).toString();
  } catch(e) {
    if (options.serviceWorker) {
      console.error(`no service worker file at ${options.serviceWorker}`);
      throw e;
    }
  }
  if (sw) {
    sw = sw.replace(
      'const URLS_TO_PRE_CACHE = [',
      'const URLS_TO_PRE_CACHE = [' +
        routes
          .filter((v) => !v.endsWith('.*'))
          .map((v) => (v === '' ? `''` : `'${v}/'`))
          .concat(precache.map((v) => `'${v}'`))
          .join(', ') +
        ','
    );

    sw = sw.replace(
      `const CACHE_NAME = 'cache-name';`,
      `const CACHE_NAME = 'cache-${(+new Date()).toString(36)}';`
    );

    sw = sw.replace(`const DEV = true;`, `const DEV = false;`);

    fs.writeFileSync(path.join(exportFolder, serviceWorkerFileName), sw);
  }
  // print(' done');
}


export function spa2ipfs(options: SPA2IPFSOptions, log?: (msg: string) => void) {
  logFunc = log || logFunc;
  const exportFolder = options.targetFolderPath || options.folderPath;
  fs.ensureDirSync(exportFolder);


  let manifest: Manifest | undefined;
  try {
    const manifestString = fs.readFileSync(path.join(options.folderPath, 'build-manifest.json')).toString();
    manifest = JSON.parse(manifestString);
  } catch (e) {
    logFunc("no build-manifest.json file found. Please enable manifest in snowpack optimize config")
  }
  // TODO transform manifest and handle case with `../~~bundle~~` in output keys
  // for now : throw if manifest: false
  if(!manifest) {
    throw new Error(`ipfs plugin requires config: optimize.manifest = true`);
  } else {
    if (manifest.outputs) {
      for(const key of Object.keys(manifest.outputs)) {
        if (key.indexOf('~~bundle~~') >=  0) {
          throw new Error(`ipfs plugin requires config: optimize.manifest=true`);
        }
      }

      const findDistPaths = '"/dist/';
      const reDistPaths = new RegExp(findDistPaths, 'g');
      const findSrcPaths = 'src="/';
      const reSrcPaths = new RegExp(findSrcPaths, 'g');
      for(const key of Object.keys(manifest.outputs)) {
        if (key.endsWith(".js")) {
          const filepath = path.join(options.folderPath, key);
          let content = fs.readFileSync(filepath).toString();
          content = content.replace(reDistPaths, 'window.basepath+"dist/');
          content = content.replace(reSrcPaths, 'src=window.basepath+"');
          fs.writeFileSync(filepath, content);
          // TODO fix sourcemap ?
        }
      }
    }
  }

  let indexHtml = fs
    .readFileSync(path.join(options.folderPath, 'index.html'))
    .toString();

  // injected in the html for each page
  // `window.relpath="/"` will then be replaced with `window.relpath=../` etc, based on how far down the route is
  const basePathScript = `
      <script>
        window.relpath="/";
        const count = (window.relpath.match(/\\.\\.\\//g) || []).length;
        let lPathname = location.pathname;
        if (lPathname.endsWith('/')) {
          lPathname = lPathname.slice(0, lPathname.length - 1);
        }
        const pathSegments = lPathname.split('/');
        window.basepath = pathSegments.slice(0, pathSegments.length - count).join('/');
        if (!window.basepath.endsWith('/')) {
          window.basepath += '/';
        }
      </script>
  `;


  let redirectEthLink = '';
  let config;
  try {
    config = JSON.parse(fs.readFileSync(options.applicationFilePath || './application.json').toString());
  } catch (e) {}
  if (config && config.ensName && options.ethLinkErrorRedirect) {

    if (manifest) {
      let fileInfos: Record<string, any> = manifest.outputs;
      if (!fileInfos) {
        fileInfos = manifest.inputs;
      }
      for (const fileKey of Object.keys(fileInfos)) {
        indexHtml = indexHtml.replace(new RegExp(escapeRegExp(`"${fileKey}"`), "g"), `"${fileKey}" onerror="window.onFailingResource()"`)
      }
    } else {
      // indexHtml = indexHtml.replace(
      //   /(="\/dist\/.*")/g,
      //   '$1 onerror="window.onFailingResource()"'
      // );  
    }
    
    fs.ensureDirSync(path.join(exportFolder, 'scripts'));
    fs.copyFileSync(path.join(__dirname, 'scripts', 'asteroid-alert.js'), path.join(exportFolder, 'scripts', 'asteroid-alert.js'));
    const handleEthLink = `
        function loadAlert() {
          return new Promise((resolve) => {
            const script = document.createElement('script');
            script.type = 'text/javascript';
            script.src = window.basepath + "scripts/asteroid-alert.js";
            script.onload = script.onreadystatechange = function () {
              resolve(window.$alert);
            };
            script.onerror = function () {
              resolve((msg) => new Promise((resolve) => {window.alert(msg); resolve();}));
            };
            document.head.appendChild(script);
          });
        }
        if(location.hostname.endsWith('eth.link') && location.search.indexOf("noipfsredirect=true") === -1) {
          window.onFailingResource = () => {
            redirectToIPFS().then((url) => {
              loadAlert().then((alert) => alert("The ENS 'eth.link' service is having caching issues causing the website to misbehave.\\nThis usually happen when the website is updated to a new ipfs hash and eth.link is catching up.\\nWe will redirect you to an ipfs gateway in the mean time:\\nSorry for the inconvenience."))
              .then(() => location.assign(url + location.pathname + location.search + location.hash))
            });
          };
        } else {
          window.onFailingResource = () => {console.error("resource failed to load");};
        }
  `;
    if (options.ethLinkErrorRedirect.redirectTo === 'hash') {
      const hash = namehash.hash(config.ensName).slice(2);
      // NOTE: This assumes the default public resolver is used
      redirectEthLink = `
        function redirectToIPFS() {
          return fetch(${options.ethLinkErrorRedirect.nodeURL}, {method: "POST", body: JSON.stringify({jsonrpc: "2.0", id: "3", method: "eth_call", params:[{to:"0x4976fb03c32e5b8cfe2b6ccb31c09ba78ebaba41", data:"0xbc1c58d1${hash}"}, "latest"]})}).then(v=>v.json()).then((json) => {
            const result = json.result;
            const hash = result && result.slice(130, 134).toLowerCase() === 'e301' && result.slice(134, 206);
            if (hash) {
              const a = 'abcdefghijklmnopqrstuvwxyz234567';
              const h = new Uint8Array(hash.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
              const l = 36;
              let b = 0;
              let v = 0;
              let o = '';
              for (let i = 0; i < l; i++) {
                v = (v << 8) | h[i];
                b += 8;
                while (b >= 5) {
                  o += a[(v >>> (b - 5)) & 31];
                  b -= 5;
                }
              }
              if (b > 0) {
                o += a[(v << (5 - b)) & 31];
              }
              const url = 'https://b' + o + '.ipfs.dweb.link';
              return url;
            }
          }).catch((e) => console.error(e));
        }
        ${handleEthLink}
  `;
    } else if (options.ethLinkErrorRedirect.redirectTo === 'ipns') {
      redirectEthLink = `
      function redirectToIPFS() {
        return new Promise((resolve) => {
          const url = 'https://ipfs.io/ipns/${config.ensName}';
          resolve(url);
        });
      }
      ${handleEthLink}
  `;
    }
  }
  // TODO preserve query params and hash when "index.html" is sliced
  // TODO preserve query params and hash when no slash at the end and this is added
  const redirectScript = `
      <script>
        let newLocation = location.href;
        if (newLocation.startsWith('http:')) {
          if (!(location.hostname === 'localhost' || location.hostname.startsWith('192.') || location.hostname.endsWith('test.eth.link') || (newLocation.endsWith('.eth.link') && location.host.split('.').length > 3))) {
            newLocation = 'https' + newLocation.slice(4);
          }
        }
        const pathname = location.pathname;
        if (pathname.endsWith('index.html')) {
          newLocation = newLocation.slice(0, newLocation.length - 10); 
        } else if (!pathname.endsWith('/')) {
          newLocation = newLocation + '/';
        }
        if (newLocation !== location.href) {
          console.log("replace : " + location.href + " -> " + newLocation);
          location.replace(newLocation);
        } else {${redirectEthLink}}
      </script>
  `;

  const linkReloadScript = `
      <script>
        // ensure we save href as they are loaded, so they do not change on page navigation
        document.querySelectorAll("link[href]").forEach((v) => v.href = v.href);
      </script>
  `;

  let scriptStart = indexHtml.indexOf('<!--SCRIPTS-->');
  if (scriptStart === -1) {
    // TODO const regex = /<meta .*charset=.*(>)/;
    scriptStart = indexHtml.indexOf('<head>') + 6;
  } else {
    scriptStart += 14;
  }
  indexHtml =
    indexHtml.slice(0, scriptStart) +
    `${basePathScript}${redirectScript}` +
    indexHtml.slice(scriptStart);


  const headEnd = indexHtml.indexOf('</head>');
  indexHtml =
    indexHtml.slice(0, headEnd) +
    `${linkReloadScript}` +
    indexHtml.slice(headEnd);

  let routes = [];
  if (typeof options.routes === 'function') {
    routes = options.routes();
  } else {
    routes = options.routes;
  }
  routes = routes.map((v) => v === '/' ? '' : v);
  generatePages(indexHtml, routes, options, manifest);
  if (options.serviceWorker) {
    generateServiceWorker(routes, options, manifest);
  }
}
