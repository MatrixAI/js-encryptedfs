async function main () {

  const ops = await Promise.all([
    Promise.resolve([1, 2, 3]),
    Promise.resolve([4, 5, 6]),
    [4,5,6]
  ]);

  console.log(ops);

  // note that how it merges the array together
  // but keeps it together

  // @ts-ignore
  console.log([].concat(...ops));

  // // @ts-ignore
  // console.log([].concat([1,2,3], [4,5,6]));

  // console.log(Array.prototype.concat.apply([], ops));
}

main();
