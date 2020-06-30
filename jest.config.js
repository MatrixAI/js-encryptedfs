module.exports = {
  "roots": [
    "<rootDir>/tests",
    "<rootDir>/src"
  ],
  "testMatch": [
    "**/?(*.)+(spec|test|unit.test).+(ts|tsx|js)"
  ],
  "transform": {
    "^.+\\.(ts|tsx)$": "ts-jest"
  },
  moduleNameMapper: {
    '@encryptedfs/(.*)$': '<rootDir>/src/$1'
  }
}
