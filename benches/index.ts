#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import si from 'systeminformation';
import { benchesPath } from './utils/utils.js';
import crypto1KiB from './crypto_1KiB.js';
import crypto10KiB from './crypto_10KiB.js';
import crypto16KiB from './crypto_16KiB.js';
import crypto24KiB from './crypto_24KiB.js';
import crypto32KiB from './crypto_32KiB.js';
import crypto100KiB from './crypto_100KiB.js';
import crypto1MiB from './crypto_1MiB.js';

async function main(): Promise<void> {
  await fs.promises.mkdir(path.join(benchesPath, 'results'), {
    recursive: true,
  });
  await crypto1KiB();
  await crypto10KiB();
  await crypto16KiB();
  await crypto24KiB();
  await crypto32KiB();
  await crypto100KiB();
  await crypto1MiB();
  const resultFilenames = await fs.promises.readdir(
    path.join(benchesPath, 'results'),
  );
  const metricsFile = await fs.promises.open(
    path.join(benchesPath, 'results', 'metrics.txt'),
    'w',
  );
  let concatenating = false;
  for (const resultFilename of resultFilenames) {
    if (/.+_metrics\.txt$/.test(resultFilename)) {
      const metricsData = await fs.promises.readFile(
        path.join(benchesPath, 'results', resultFilename),
      );
      if (concatenating) {
        await metricsFile.write('\n');
      }
      await metricsFile.write(metricsData);
      concatenating = true;
    }
  }
  await metricsFile.close();
  const systemData = await si.get({
    cpu: '*',
    osInfo: 'platform, distro, release, kernel, arch',
    system: 'model, manufacturer',
  });
  await fs.promises.writeFile(
    path.join(benchesPath, 'results', 'system.json'),
    JSON.stringify(systemData, null, 2),
  );
}

void main();
