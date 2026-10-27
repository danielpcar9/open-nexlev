import { resolveDatabasePath } from './path';

console.log(resolveDatabasePath(process.argv[2] || './open-nexlev.db'));
