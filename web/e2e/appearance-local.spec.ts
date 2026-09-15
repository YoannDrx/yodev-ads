import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  for (const authenticated of [false,true]) test(`shared appearance and accessible layout: ${authenticated ? 'workspace' : 'public'}`, async ({browser},testInfo) => {
    const context=await browser.newContext({baseURL:process.env.PLAYWRIGHT_BASE_URL,storageState:authenticated?process.env.PLAYWRIGHT_OWNER_STORAGE_STATE:undefined});
    await context.addCookies([{name:'yodev_cookie_consent',value:'rejected',url:process.env.PLAYWRIGHT_BASE_URL!}]);
    const page=await context.newPage();
    try {
      await page.goto(authenticated?'/dashboard':'/');
      await expect(page.locator('html')).toHaveClass(/dark/);
      for (const width of [390,768,1440]) {
        await page.setViewportSize({width,height:900});
        for (const theme of ['dark','light']) {
          if (!(await page.locator('html').getAttribute('class'))?.includes(theme)) await page.getByRole('button',{name:/Changer le thème|Change theme/}).click();
          await expect(page.locator('html')).toHaveClass(new RegExp(theme));
          expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
          const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
          expect(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
          await page.screenshot({path:testInfo.outputPath(`ads-${authenticated?'app':'public'}-${width}-${theme}.png`)});
        }
      }
      await page.reload();
      await expect(page.locator('html')).toHaveClass(/light/);
    } finally {await context.close();}
  });
}
