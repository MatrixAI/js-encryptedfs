#!/usr/bin/env node

import fs from 'fs';
import si from 'systeminformation';
import crypto1KiBBench from './crypto1KiB';
import crypto10KiBBench from './crypto10KiB';
import crypto16KiBBench from './crypto16KiB';
import crypto24KiBBench from './crypto24KiB';
import crypto32KiBBench from './crypto32KiB';
import crypto100KiBBench from './crypto100KiB';
import crypto1MiBBench from './crypto1MiB';
import DB1KiBBench from './DB1KiB';
import DB24KiBBench from './DB24KiB';
import DB1MiBBench from './DB1MiB';

async function main(): Promise<void> {
  await crypto1KiBBench();
  await crypto10KiBBench();
  await crypto16KiBBench();
  await crypto24KiBBench();
  await crypto32KiBBench();
  await crypto100KiBBench();
  await crypto1MiBBench();
  await DB1KiBBench();
  await DB24KiBBench();
  await DB1MiBBench();
  const systemData = await si.get({
    cpu: '*',
    osInfo: 'platform, distro, release, kernel, arch',
    system: 'model, manufacturer',
  });
  await fs.promises.writeFile(
    'benches/results/system.json',
    JSON.stringify(systemData, null, 2),
  );
}

main();
