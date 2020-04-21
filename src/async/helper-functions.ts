// Taken from gist: https://gist.github.com/sergiodxa/06fabb866653bd8b3165e9fe9fd8036b

function asyncThread(fn: { toString: () => any; }, ...args: any[]) {
    if (!window.Worker) throw Promise.reject(
      new ReferenceError(`WebWorkers aren't available.`)
    );
    
    const fnWorker = `
    self.onmessage = function(message) {
      (${fn.toString()})
        .apply(null, message.data)
        .then(result => self.postMessage(result));
    }`;
    
    return new Promise((resolve, reject) => {
      try {
        const blob = new Blob([fnWorker], { type: 'text/javascript' });
        const blobUrl = window.URL.createObjectURL(blob);
        const worker = new Worker(blobUrl);
        window.URL.revokeObjectURL(blobUrl);
        
        worker.onmessage = result => {
          resolve(result.data);
          worker.terminate();
        };
  
        worker.onerror = error => {
          reject(error);
          worker.terminate();
        };
  
        worker.postMessage(args);
      } catch (error) {
        reject(error);
      }
    });
  }

  function thread(fn, ...args) {
    if (!window.Worker) throw Promise.reject(
      new ReferenceError(`WebWorkers aren't available.`)
    );
  
    const fnWorker = `
    self.onmessage = function(message) {
      self.postMessage(
        (${fn.toString()}).apply(null, message.data)
      );
    }`;
  
    return new Promise((resolve, reject) => {
      try {
        const blob = new Blob([fnWorker], { type: 'text/javascript' });
        const blobUrl = window.URL.createObjectURL(blob);
        const worker = new Worker(blobUrl);
        window.URL.revokeObjectURL(blobUrl);
        
        worker.onmessage = result => {
          resolve(result.data);
          worker.terminate();
        };
  
        worker.onerror = error => {
          reject(error);
          worker.terminate();
        };
  
        worker.postMessage(args);
      } catch (error) {
        reject(error);
      }
    });
  }
  
  // example with an async/await function
  (async () => {
    try {
      const res1 = await thread(
        str => JSON.parse(str),
        '{"key": "value"}'
      );
      console.log(res1);
    } catch (error) {
      console.error(error);
    }
  })();
  
  // example using a sum function and promise syntax
  // function sum(n1, n2) {
  //   return n1 + n2;
  // }
  // thread(sum, 1, 5)
  //   .then(result => thread(sum, result, 1))
  //   .then(result => console.log('result', result))
  //   .catch(error => console.error('error', error));