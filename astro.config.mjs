import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  server: {
    host: true,
    port: 4333
  },
  base: '/',

  markdown: {
    shikiConfig: {
      // 默认的 github-dark 是中性灰黑，跟本站的樱粉 / 暗紫配色不搭。
      // 换成 rosé pine —— 暗紫底 + 玫瑰粉、金、青的柔和配色，与代码窗口同一套调子。
      // 注意：<pre> 上仍会被写死背景色，实际外观由 theme.css 里的 .code-wrapper 接管。
      theme: 'rose-pine'
    }
  }
});
