import type { DBLevel, DBOp } from '@/db/types';

import os from 'os';
import path from 'path';
import fs from 'fs';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import * as vfs from 'virtualfs';
import { DB } from '@/db';
import { INodeManager } from '@/inodes';
import * as utils from '@/utils';
import { countReset } from 'console';

describe('INodeManager', () => {
  const logger = new Logger('INodeManager Test', LogLevel.WARN, [new StreamHandler()]);
  const devMgr = new vfs.DeviceManager();
  let dataDir: string;
  let db: DB;
  let dbKey: Buffer = utils.generateKeySync(256);
  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'encryptedfs-test-'),
    );
    db = new DB({
      dbKey,
      dbPath: `${dataDir}/db`,
      logger
    });
    await db.start();
  });
  afterEach(async () => {
    await db.stop();
    await fs.promises.rm(dataDir, {
      force: true,
      recursive: true,
    });
  });
  test.only('create and destroy directories', async () => {
    const iNodeMgr = await INodeManager.createINodeManager({
      db,
      devMgr,
      logger
    });
    const parentIno = iNodeMgr.inoAllocate();
    const childIno = iNodeMgr.inoAllocate()
    await iNodeMgr.transaction(async (tran) => {
      tran.queueFailure(() => {
        iNodeMgr.inoDeallocate(parentIno);
        iNodeMgr.inoDeallocate(childIno);
      });
      await iNodeMgr.dirCreate(tran, parentIno, {
        mode: vfs.DEFAULT_ROOT_PERM,
        uid: vfs.DEFAULT_ROOT_UID,
        gid: vfs.DEFAULT_ROOT_GID
      });
      await iNodeMgr.dirCreate(tran, childIno, {
        mode: vfs.DEFAULT_DIRECTORY_PERM
      }, parentIno);
      await iNodeMgr.dirSetEntry(
        tran,
        parentIno,
        'childdir',
        childIno
      );
      console.log(tran.ops);
    }, [parentIno, childIno]);
  });


  // });
  // test('create directories and subdirectories', async () => {
  //   const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
  //   const [parentINode, parentINodeIndex] = await iNodeMgr.createINode(
  //     'Directory',
  //     {
  //       params: {
  //         mode: vfs.DEFAULT_ROOT_PERM,
  //       }
  //     }
  //   );
  //   const [childINode, childINodeIndex] = await iNodeMgr.createINode(
  //     'Directory',
  //     {
  //       params: {
  //         mode: vfs.DEFAULT_DIRECTORY_PERM
  //       },
  //       parent: parentINode
  //     }
  //   );
  //   await parentINode.addEntry('child', childINode);
  //   // child .. points to parent index
  //   const childINodeIndex_ = await parentINode.getEntryIndex('child');
  //   expect(childINodeIndex).toBe(childINodeIndex_);
  //   const childINode_ = await parentINode.getEntry('child');
  //   expect(childINode).toBe(childINode_);
  //   // child .. points to parent
  //   const parentINodeIndex_ = await childINode.getEntryIndex('..');
  //   expect(parentINodeIndex).toBe(parentINodeIndex_);
  //   const parentINode_ = await childINode.getEntry('..');
  //   expect(parentINode).toBe(parentINode_);
  //   // child points to itself and the parent points to to the child
  //   const childNlink = await childINode.getStatProp('nlink');
  //   expect(childNlink).toBe(2);
  //   // parent points to itself twice and child points to it
  //   const parentNlink = await parentINode.getStatProp('nlink');
  //   expect(parentNlink).toBe(3);

  //   // without a proper snapshot system
  //   // the whole locking system won't work well
  //   // so first you need leveldb transaction snapshots
  //   // then you combine that with lock laziness

  //   // await iNodeMgr.getAll();

  // });
  // test.only('remove child directories', async () => {
  //   const iNodeMgr = await INodeManager.createINodeManager({ db, devMgr, logger });
  //   const [parentINode, parentINodeIndex] = await iNodeMgr.createINode(
  //     'Directory',
  //     {
  //       params: {
  //         mode: vfs.DEFAULT_ROOT_PERM,
  //       }
  //     }
  //   );

  //   // we can pass a lock here to acquire
  //   // during the creation
  //   // and then prevent it from other stuff
  //   // nothing can delete it just yet
  //   const lock = new Mutex;
  //   await lock.runExclusive(async () => {

  //     // this ensures that we run the lock relevant to the inode

  //     const [childINode, childINodeIndex] = await iNodeMgr.createINode(
  //       'Directory',
  //       {
  //         params: {
  //           mode: vfs.DEFAULT_DIRECTORY_PERM
  //         },
  //         parent: parentINode,
  //         lock
  //       }
  //     );
  //     await parentINode.addEntry('child', childINode);

  //     // deleteEntry occurs on the thing
  //     // and it doesn't call GC
  //     // it cals GCops
  //     // cause it tries to compose
  //     // so unlinkINodeops doesn't yet apply...
  //     // deleteEntry -> unlinkINodeOps -> gcINodeOps -> destroyOps MULTIPLE
  //     // but nobody calls GC
  //     // cause it hasn't hapepned yet
  //     // if it is SINGLETHREADED
  //     // just use a lock in total for the FS
  //     // let's say you put it in the other place
  //     // then you create a deletion operation
  //     // that also cycles and deletes other ones too
  //     // so at the call to gcINodeOps
  //     // you bundle up other ones
  //     // but rather than cycling through all inodes you want to cycle through
  //     // that which is currently "unlinked"
  //     // so in the GC queue
  //     // so deletion ends up removing and anything that was still just created
  //     // but requires locking!

  //     // unless you start it easlier!

  //     await parentINode.transaction(async () => {
  //       await lock.runExclusive(async () => {

  //           dirCreateOps()
  //           dirSetEntryOps(inode, inode);

  //         // DO parent and child operations!

  //       });
  //     });


  //     const ops = createINodeOps();
  //     const ops = ops.concat(
  //       createINodeOps(),
  //       addEntryOps(),
  //     );


  //   });



  //   // the idea is that we lock


  //   // const parentNlink1 = await parentINode.getStatProp('nlink');
  //   // expect(parentNlink1).toBe(3);
  //   // await parentINode.deleteEntry('child');
  //   // // this should be removed
  //   // expect(await parentINode.getEntry('child')).toBeUndefined();
  //   // expect(await parentINode.getEntryIndex('child')).toBeUndefined();
  //   // // nlink should have reduced to 2
  //   // const parentNlink2 = await parentINode.getStatProp('nlink');
  //   // expect(parentNlink2).toBe(2);


  // });
});
