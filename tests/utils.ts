
/**
 *
 * @param promise - the Promise that throws the expected error.
 * @param code - Error code such as 'errno.ENOTDIR'
 */
async function expectError(promise: Promise<any>, code){
  await expect(promise).rejects.toThrow();
  await expect(promise).rejects.toHaveProperty("code", code.code);
  await expect(promise).rejects.toHaveProperty("errno", code.errno);
}

export {
  expectError,
}
