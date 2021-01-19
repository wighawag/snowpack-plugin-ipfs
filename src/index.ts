import type {PluginOptimizeOptions, SnowpackConfig, SnowpackPlugin} from 'snowpack';
import {spa2ipfs} from './lib';

export type SPA2IPFSPluginOptions = {
  routes: string[];
  // targetFolderPath?: string; // TODO remove
  serviceWorkerFileName?: string;
  useBaseElem?: boolean;
  ethLinkErrorRedirect?: {redirectTo: 'ipns' | 'hash', nodeURL: string};
  applicationFilePath?: string;
  injectDebugConsole?: boolean;
};

export default function (snowpackConfig: SnowpackConfig, options: SPA2IPFSPluginOptions): SnowpackPlugin {
  return {
    name: 'snowpack-plugin-ipfs',
    async optimize({buildDirectory}: PluginOptimizeOptions): Promise<void> {
      await spa2ipfs({...options, folderPath: buildDirectory, routes: options.routes.map((v) => v === '/' ? '' : v)})
    },
  };
};
