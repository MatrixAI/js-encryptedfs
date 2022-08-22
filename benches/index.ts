#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import si from 'systeminformation';
import crypto1KiB from './crypto_1KiB';
import crypto10KiB from './crypto_10KiB';
import crypto16KiB from './crypto_16KiB';
import crypto24KiB from './crypto_24KiB';
import crypto32KiB from './crypto_32KiB';
import crypto100KiB from './crypto_100KiB';
import crypto1MiB from './crypto_1MiB';

async function main(): Promise<void> {
  await fs.promises.mkdir(path.join(__dirname, 'results'), { recursive: true });
  await crypto1KiB();
  await crypto10KiB();
  await crypto16KiB();
  await crypto24KiB();
  await crypto32KiB();
  await crypto100KiB();
  await crypto1MiB();
  const resultFilenames = await fs.promises.readdir(
    path.join(__dirname, 'results'),
  );
  const metricsFile = await fs.promises.open(
    path.join(__dirname, 'results', 'metrics.txt'),
    'w',
  );
  let concatenating = false;
  for (const resultFilename of resultFilenames) {
    if (/.+_metrics\.txt$/.test(resultFilename)) {
      const metricsData = await fs.promises.readFile(
        path.join(__dirname, 'results', resultFilename),
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
    path.join(__dirname, 'results', 'system.json'),
    JSON.stringify(systemData, null, 2),
  );
}

void main();
