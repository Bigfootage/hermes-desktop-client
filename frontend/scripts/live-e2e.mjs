import { chromium } from '@playwright/test';

const apiKey = process.env.HERMES_API_KEY;
if (!apiKey) throw new Error('Set HERMES_API_KEY for the live test');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', (error) => consoleErrors.push(error.message));

try {
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  const connectionHeading = page.getByRole('heading', { name: 'Connect to Hermes' });
  if (await connectionHeading.isVisible().catch(() => false)) {
    await page.getByLabel('API base URL').fill('http://127.0.0.1:8642');
    await page.getByLabel('API key').fill(apiKey);
    await page.getByRole('button', { name: 'Connect' }).click();
  }

  await page.getByRole('heading', { name: 'Hermes conversation' }).waitFor({ timeout: 15_000 });
  await page.getByText('Connected', { exact: true }).first().waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Collapse sidebar' }).waitFor();
  await page.getByRole('button', { name: /New conversation/i }).first().waitFor();

  const prompt = 'Check the current time on the VM using a tool, then reply with the exact result.';
  await page.getByLabel('Message Hermes').fill(prompt);
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByText(prompt, { exact: true }).waitFor();
  // Wait for the Send button to become enabled again (stream finishes)
  await page.getByRole('button', { name: 'Send message' }).waitFor({ timeout: 120_000 });
  const assistantText = await page.locator('article').last().innerText();
  if (!assistantText || assistantText.trim() === 'Hermes') throw new Error('Assistant response was empty');
  const activityVisible = await page.getByLabel('Response activity').isVisible().catch(() => false);

  await page.getByRole('button', { name: 'Long task' }).click();
  await page.getByRole('complementary', { name: 'Long-running tasks' }).waitFor();
  await page.getByLabel('Long task instructions').fill('Reply with exactly RUNS_OK and do not use tools.');
  await page.getByRole('button', { name: 'Start run' }).click();
  await page.getByText('RUNS_OK', { exact: true }).waitFor({ timeout: 90_000 });
  await page.getByText('completed', { exact: true }).first().waitFor({ timeout: 90_000 });
  const runId = (await page.getByTitle('Copy run ID').innerText()).trim();
  if (!runId.startsWith('run_')) throw new Error(`Unexpected run id: ${runId}`);

  await page.screenshot({ path: '/root/hermes-phase-b3-e2e.png', fullPage: true });
  console.log(JSON.stringify({ connected: true, chat_response: true, activity_visible: activityVisible, assistant_chars: assistantText.length, run_completed: true, run_id_valid: true, console_errors: consoleErrors.length }));
  if (consoleErrors.length) console.error(consoleErrors.join('\n'));
} catch (error) {
  await page.screenshot({ path: '/root/hermes-e2e-failure.png', fullPage: true });
  console.error((await page.locator('body').innerText()).slice(0, 6000));
  throw error;
} finally {
  await browser.close();
}
