#!/usr/bin/env node

import esbuild, { BuildOptions, Plugin } from "esbuild";
import minimist from "minimist";
import readConfig, { ResolvedWorkerConfig } from "./utils/config.js";
import { emptyModulesPlugin } from "@remix-run/dev/dist/compiler/plugins/emptyModules.js";
import path from "node:path";
import entryModulePlugin from "./plugins/entry-module.js";
import routesModulesPlugin from "./plugins/routes-module.js";
import sideEffectsPlugin from "./plugins/side-effects.js";
import { ServerMode } from "@remix-run/dev/dist/config/serverModes.js";
import type { Context } from "@remix-run/dev/dist/compiler/context.js";

const { NODE_ENV } = process.env;
const TIME_LABEL = "💿 Built in";
const MODE =
  NODE_ENV === "production" ? ServerMode.Production : ServerMode.Development;
// note: leaving this at the moment until we have a the `cli` implementation.
const { watch } = minimist(process.argv.slice(2));

/**
 * Creates the esbuild config object.
 */
function createEsbuildConfig(config: ResolvedWorkerConfig): BuildOptions {
  const pluginContext = { config } as unknown as Context;
  return {
    entryPoints: {
      [config.workerName]: config.worker,
    },
    outdir: config.workerBuildDirectory,
    platform: "browser",
    format: "esm",
    bundle: true,
    logLevel: "error",
    splitting: true,
    sourcemap: config.workerSourcemap,
    // As pointed out by https://github.com/evanw/esbuild/issues/2440, when tsconfig is set to
    // `undefined`, esbuild will keep looking for a tsconfig.json recursively up. This unwanted
    // behavior can only be avoided by creating an empty tsconfig file in the root directory.
    // tsconfig: ctx.config.tsconfigPath,
    mainFields: ["browser", "module", "main"],
    treeShaking: true,
    minify: config.workerMinify,
    chunkNames: "_shared/sw/[name]-[hash]",
    plugins: [
      emptyModulesPlugin(pluginContext, /\.server(\.[jt]sx?)?$/) as Plugin,
      // assuming that we dont need react at all in the worker (we dont want to SWSR for now at least)
      emptyModulesPlugin(pluginContext, /^react(-dom)?(\/.*)?$/, {
        includeNodeModules: true,
      }) as Plugin,
      emptyModulesPlugin(
        pluginContext,
        /^@remix-run\/(deno|cloudflare|node)(\/.*)?$/,
        { includeNodeModules: true }
      ) as Plugin,
      // This plugin will generate a list of routes based on the remix `flatRoutes` output and inject them in the bundled `service-worker`.
      entryModulePlugin(config),
      // for each route imported with`?worker` suffix this plugin will only keep the `workerAction` and `workerLoader` exports
      routesModulesPlugin(config),
      // we need to tag the user entry.worker as sideEffect so esbuild will not remove it
      sideEffectsPlugin(),
    ],
    supported: {
      "import-meta": true,
    },
  };
}

readConfig(path.resolve("./"), MODE).then((remixConfig) => {
  console.time(TIME_LABEL);
  // @TODO: Support for multiple entry.worker.js files.
  // We should run the esbuild for each entry.worker.js file.
  esbuild
    .context({
      ...createEsbuildConfig(remixConfig),
      metafile: true,
      write: true,
    })
    .then(async (context) => {
      console.log(`Building service-worker app in ${MODE} mode`);
      try {
        if (!watch) {
          return context.dispose();
        }
        await context.watch();
        console.timeEnd(TIME_LABEL);
        console.log("Watching for changes in the service-worker");
      } catch (error) {
        console.error(error);
      }
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
});