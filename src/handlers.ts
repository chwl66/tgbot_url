import { Env, Message, PhotoSize, Document, Video, Audio, Voice, WebhookInfo } from './types';
import { getFileInfo, checkWebhookAuth, sendMessage, telegramApi, jsonResponse } from './utils';

/**
 * Handles requests to proxy a file from Telegram.
 * It expects a URL like /file/<FILE_ID>.
 * By default, it redirects the client directly to the temporary Telegram download URL.
 * This is efficient and allows direct use in browser contexts (e.g., <img src="...">).
 * If the query parameter `json=true` is provided, it returns file metadata as JSON.
 * @param request The incoming request.
 * @param env The environment variables.
 * @param params The route parameters, containing the file_id.
 * @returns A 302 Redirect Response or a JSON response with file info.
 */
export async function handleFileProxy(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
	const { file_id } = params;
	if (!file_id) {
		return jsonResponse({ status: 'error', message: 'File ID is missing.' }, 400);
	}
	const url = new URL(request.url);
	const returnJson = url.searchParams.get('json') === 'true';
	console.log(`✨ Proxying file with ID: ${file_id}. Return JSON: ${returnJson}`);

	try {
		const file_info = await getFileInfo(file_id, env);
		if (!file_info.file_path) {
			throw new Error('file_path not available in file info.');
		}
		const file_url = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file_info.file_path}`;

		if (returnJson) {
			console.log(`Returning JSON info for file: ${file_id}`);
			return jsonResponse({
				status: 'success',
				file_info: {
					...file_info,
					download_url: file_url,
				},
			});
		} else {
			console.log(`Redirecting to: ${file_url}`);
			return Response.redirect(file_url, 302);
		}
	} catch (error: any) {
		console.error(`🚫 Failed to proxy file:`, error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		return jsonResponse({ status: 'error', message: `Proxy failed: ${errorMessage}` }, 500);
	}
}

/**
 * Handles incoming POST requests from the Telegram webhook.
 * It processes messages containing files, photos, videos, etc., and replies with a public link.
 * @param request The incoming request from Telegram.
 * @param env The environment variables.
 * @param params The route parameters (unused in this handler).
 * @returns A Response to acknowledge receipt to Telegram.
 */
export async function handleWebhook(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
	console.log('📦 Webhook request received');

	if (!(await checkWebhookAuth(request, env))) {
		return jsonResponse({ status: 'error', message: 'Unauthorized webhook request' }, 403);
	}

	try {
		const body: { message?: Message } = await request.json();
		const message = body.message;

		if (!message) {
			console.warn('🟠 Webhook update does not contain a processable message. Body:', JSON.stringify(body));
			return jsonResponse({ status: 'ok', message: 'Update received, but no message to process.' });
		}
		console.log('📢 Received message:', message.text || '(No text content)');

		const { document, photo, video, audio, voice } = message;
		const media: Document | Video | Audio | Voice | PhotoSize | undefined =
			document || video || audio || voice || (photo && photo.sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0]);

		if (media && media.file_id) {
			console.log('🖼️ Received a file.');
			const file_id = media.file_id;
			const file_name = 'file_name' in media && media.file_name ? media.file_name : 'telegram_file';

			const worker_host = env.WORKER_URL || new URL(request.url).host;
			const public_file_url = `https://${worker_host}/file/${file_id}`;

			console.log(`📍 Public file URL: ${public_file_url}`);
			await sendMessage(message.chat.id, `已收到文件: ${file_name}\n下载链接: ${public_file_url}`, env);
		} else {
			console.log('🗣️ Received a text message, providing help.');
			const helpText = `你好！请直接向我发送文件、图片、视频或音频，我将为你生成一个公开的下载链接。

你可以通过浏览器访问以下管理端点：
- \`/setWebhook\`：设置 Webhook
- \`/deleteWebhook\`：删除 Webhook
- \`/info\`：获取 Webhook 信息
- \`/debug\`：查看 Worker 状态`;
			await sendMessage(message.chat.id, helpText, env, 'Markdown');
		}

		return jsonResponse({ status: 'success' });
	} catch (error: any) {
		console.error('🚨 Error processing webhook:', error.message);
		return jsonResponse({ status: 'error', message: 'Internal error processing webhook.' }, 500);
	}
}

/**
 * Sets the webhook for the Telegram bot to point to this worker.
 * @param request The incoming request.
 * @param env The environment variables.
 * @param params The route parameters (unused in this handler).
 * @returns A Response indicating success or failure.
 */
export async function setWebhook(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
	const worker_host = env.WORKER_URL || new URL(request.url).host;
	const webhookUrl = `https://${worker_host}/webhook`;

	console.log(`🔄 Setting Telegram webhook to: ${webhookUrl}`);
	try {
		await telegramApi<boolean>('setWebhook', env.BOT_TOKEN, {
			url: webhookUrl,
			secret_token: env.SECRET_TOKEN || '',
		});
		const message = `✅ Webhook set successfully to: ${webhookUrl}`;
		console.log(message);
		return jsonResponse({ status: 'success', message });
	} catch (error: any) {
		console.error(`🚫 Failed to set webhook: ${error.message}`);
		return jsonResponse({ status: 'error', message: error.message }, 500);
	}
}

/**
 * Deletes the webhook for the Telegram bot.
 * @param request The incoming request.
 * @param env The environment variables.
 * @param params The route parameters (unused in this handler).
 * @returns A Response indicating success or failure.
 */
export async function deleteWebhook(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
	console.log('🔄 Deleting Telegram webhook...');
	try {
		await telegramApi<boolean>('setWebhook', env.BOT_TOKEN, { url: '' });
		console.log('✅ Webhook deleted successfully.');
		return jsonResponse({ status: 'success', message: 'Webhook deleted successfully.' });
	} catch (error: any) {
		console.error(`🚫 Failed to delete webhook: ${error.message}`);
		return jsonResponse({ status: 'error', message: error.message }, 500);
	}
}

/**
 * Gets information about the current webhook.
 * @param request The incoming request.
 * @param env The environment variables.
 * @param params The route parameters (unused in this handler).
 * @returns A Response with the webhook information.
 */
export async function getWebhookInfo(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
	console.log('🔍 Querying webhook info...');
	try {
		const info = await telegramApi<WebhookInfo>('getWebhookInfo', env.BOT_TOKEN);
		console.log('ℹ️ Webhook info:', info);
		return jsonResponse({ status: 'success', webhook_info: info });
	} catch (error: any) {
		console.error(`🚫 Failed to get webhook info: ${error.message}`);
		return jsonResponse({ status: 'error', message: error.message }, 500);
	}
}

/**
 * A debug endpoint to check environment status and configuration.
 * Redacts sensitive information.
 * @param request The incoming request.
 * @param env The environment variables.
 * @param params The route parameters (unused in this handler).
 * @returns A Response with debug information.
 */
export async function debugEnv(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
	const worker_host = env.WORKER_URL || new URL(request.url).host;
	return jsonResponse({
		status: 'success',
		message: 'Telegram File Proxy Worker is running.',
		env: {
			bot_token: env.BOT_TOKEN ? '[REDACTED]' : 'Not Set',
			secret_token: env.SECRET_TOKEN ? '[REDACTED]' : 'Not Set',
			worker_url: env.WORKER_URL || `Not Set (using request host: ${worker_host})`,
		},
	});
}
