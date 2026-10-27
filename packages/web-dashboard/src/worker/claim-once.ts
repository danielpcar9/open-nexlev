import { openDatabase } from '../db/connection';
import { claimJob } from '../services/jobs';

const sqlite = openDatabase(process.argv[2]);
const job = claimJob(sqlite, process.argv[3] || 'worker', 60_000);
console.log(job ? job.id : 'NONE');
sqlite.close();
