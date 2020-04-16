onmessage = function(msg) {
    console.log('Received this message from the main thread: ' + msg.data);

    // perform some crazy cpu-intensive task here!

    // send a message back to the main thread
    postMessage("Hello main thread!", "");

    close();
}

onerror = function(e) {
    console.log("Oh no! Worker thread error: " + e);
    return true;
}