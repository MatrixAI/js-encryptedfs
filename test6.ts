// imagine ops + lock contexts that can be joined together
// so that way it's possible to combine atomic operations and bubble it up later
// plus since you haven't locked the op creation yet
// you need to parameterize the ops
// each operation return ops
// you want a monad calculation so you can join them together

const ops = [
    (p) => {
        return [
            {
                type: 'del',
                key: p
            }
        ];
    },
    (p) => {
        return [
            {
                type: 'del',
                key: p
            }
        ];
    }
]

// lets say we create a lazy set of operations
// like batching
// where we take the previous one


// m a >>= (\a -> m b) >>= (\b -> m c)
// so the "context" here is joined together
// that context is an "object"

// it make suse of the DB
// but it actaully runs a chain of operations
// plus you have to "add" additional locks

class Transaction {


    public chain (locks) {

    }

    public execute () {

        // perform the ops that unwrap the chain

        ops = this.unwrapChain();
        this.db.batch(ops);

    }

}

// this is return a
// it represents the initial transaction
// and we can bubble up the transaction
// then execute the tranaction

const t = new Transaction();


// imagine

/*

  createDirectory () {
      doSomethinElseOps
  }

  return Directory.createDirectory() {
      // ...
  }

  // and you are "binding" the operation
  // asynchronously too
  // but you never actually execute it

  // right now ops are joined together to be executed

*/
