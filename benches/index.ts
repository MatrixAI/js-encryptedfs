#!/usr/bin/env node

import fs from 'fs';
import si from 'systeminformation';
import DB1KiBBench from './DB1KiB';
import DB1MiBBench from './DB1MiB';
import crypto1KiBBench from './crypto1KiB';
import crypto1MiBBench from './crypto1MiB';

async function main(): Promise<void> {
  await crypto1KiBBench();
  await crypto1MiBBench();
  await DB1KiBBench();
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
