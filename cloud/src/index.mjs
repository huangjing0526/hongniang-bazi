// Cloudflare Worker 入口：静态资源交给 ASSETS，/api/* 交给共用逻辑。
// 自有服务器版见 cloud/server.mjs，两边共用 cloud/src/api.mjs。

import { handleApi } from './api.mjs';

export default {
  async fetch(request, env) {
    const response = await handleApi(request, env);
    return response ?? env.ASSETS.fetch(request);
  },
};
