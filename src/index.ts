import type {PluginOptimizeOptions, SnowpackConfig, SnowpackPlugin} from 'snowpack';
import {spa2ipfs} from './lib';

export type SPA2IPFSPluginOptions = {
  routes: string[] | (() => string[]);
  // targetFolderPath?: string; // TODO remove
  serviceWorker?: string;
  useBaseElem?: boolean;
  ethLinkErrorRedirect?: {redirectTo: 'ipns' | 'hash', nodeURL: string};
  applicationFilePath?: string;
  injectDebugConsole?: boolean;
};

export default function (snowpackConfig: SnowpackConfig, options: SPA2IPFSPluginOptions): SnowpackPlugin {
  return {
    name: 'snowpack-plugin-ipfs',
    async optimize({buildDirectory, log}: PluginOptimizeOptions & {log?: (msg: string) => void}): Promise<void> {
      await spa2ipfs({...options, folderPath: buildDirectory}, log);
    },
  };
};
