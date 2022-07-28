import path from 'path';
import 'jest-extended'; // Import jest-extended types

declare global {
  namespace NodeJS {
    interface Global {
      projectDir: string;
      testDir: string;
      defaultTimeout: number;
    }
  }
}

global.projectDir = path.join(__dirname, '../');
global.testDir = __dirname;
global.defaultTimeout = 10000;
