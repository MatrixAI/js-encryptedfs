
const a = null;
try {
  const a = 3;
  throw new Error();
} catch (e) {
  if (a == null) {
    console.log('OH NO IT IS A NULL');
  }
}
