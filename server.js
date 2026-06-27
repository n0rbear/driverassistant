error: column "day_of_week" of relation "tours" does not exist
    at /opt/render/project/src/node_modules/pg-pool/index.js:45:11
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async /opt/render/project/src/server.js:83:32 {
  length: 129,
  severity: 'ERROR',
  code: '42703',
  detail: undefined,
  hint: undefined,
  position: '55',
  internalPosition: undefined,
  internalQuery: undefined,
  where: undefined,
  schema: undefined,
  table: undefined,
  column: undefined,
  dataType: undefined,
  constraint: undefined,
  file: 'parse_target.c',
  line: '1068',
  routine: 'checkInsertTargets'
}
==> Deploying...
==> Setting WEB_CONCURRENCY=1 by default, based on available CPUs in the instance
==> Running 'node server.js'
🚀 ERP Rendszer elindult a 10000 porton.
/opt/render/project/src/node_modules/pg-pool/index.js:45
    Error.captureStackTrace(err)
          ^
error: UNION types bigint and text cannot be matched
    at /opt/render/project/src/node_modules/pg-pool/index.js:45:11
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async /opt/render/project/src/server.js:135:21 {
  length: 120,
  severity: 'ERROR',
  code: '42804',
  detail: undefined,
  hint: undefined,
  position: '340',
  internalPosition: undefined,
  internalQuery: undefined,
  where: undefined,
  schema: undefined,
  table: undefined,
  column: undefined,
  dataType: undefined,
  constraint: undefined,
  file: 'parse_coerce.c',
  line: '1414',
  routine: 'select_common_type'
}
Node.js v24.14.1
error: column "notes" of relation "tours" does not exist
    at /opt/render/project/src/node_modules/pg-pool/index.js:45:11
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async /opt/render/project/src/server.js:83:32 {
  length: 123,
  severity: 'ERROR',
  code: '42703',
  detail: undefined,
  hint: undefined,
  position: '68',
  internalPosition: undefined,
  internalQuery: undefined,
  where: undefined,
  schema: undefined,
  table: undefined,
  column: undefined,
  dataType: undefined,
  constraint: undefined,
  file: 'parse_target.c',
  line: '1068',
  routine: 'checkInsertTargets'
}
==> Exited with status 1
==> Common ways to troubleshoot your deploy: https://render.com/docs/troubleshooting-deploys
==> Running 'node server.js'
🚀 ERP Rendszer elindult a 10000 porton.
