import { createDatabaseClient, createSiteContext, errorResponse, BackendError } from './_qoder/backend.mjs';
import { application } from './routes.mjs';

// 仅启用 database + functions，不启用 Storage；业务路由匿名可用，鉴权由 editToken 负责。
const handle = application({ db: createDatabaseClient(), BackendError });
Deno.serve(async request => {
  let context;
  try { context = createSiteContext(request); return await handle(context); }
  catch (error) { return errorResponse(error, context?.requestId); }
});
