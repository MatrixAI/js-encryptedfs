function doSomething (x: number = woahNelly()) {
    console.log(x);
}

function woahNelly () {
    console.log('executed!');
    return 1;
}

doSomething(4);
