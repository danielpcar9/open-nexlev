import { openDatabase } from './connection';

const sqlite = openDatabase(process.argv[2]);
console.log('migrated');
sqlite.close();
