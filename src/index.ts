export interface Env {
	BOT_TOKEN: string;
	SECRET_TOKEN: string;
	WORKER_URL?: string;
}

// --- Telegram API Types ---

interface User {
	id: number;
	is_bot: boolean;
	first_name: string;
	last_name?: string;
	username?: string;
}

interface Chat {
	id: number;
	type: 'private' | 'group' | 'supergroup' | 'channel';
	title?: string;
	username?: string;
}

interface PhotoSize {
	file_id: string;
	file_unique_id: string;
	width: number;
	height: number;
	file_size?: number;
}

interface Document {
	file_id: string;
	file_unique_id: string;
	file_name?: string;
	mime_type?: string;
	file_size?: number;
}

interface Video {
	file_id: string;
	file_unique_id: string;
	width: number;
	height: number;
	duration: number;
	file_name?: string;
	mime_type?: string;
	file_size?: number;
}

interface Audio {
	file_id: string;
	file_unique_id: string;
	duration: number;
	file_name?: string;
	mime_type?: string;
	file_size?: number;
}

interface Voice {
	file_id: string;
	file_unique_id: string;
	duration: number;
	mime_type?: string;
	file_size?: number;
}

interface Message {
	message_id: number;
	from?: User;
	chat: Chat;
	date: number;
	text?: string;
	photo?: PhotoSize[];
	document?: Document;
	video?: Video;
	audio?: Audio;
	voice?: Voice;
}

interface Update {
	update_id: number;
	message?: Message;
}

interface File {
	file_id: string;
	file_unique_id: string;
	file_size?: number;
	file_path?: string;
}

interface WebhookInfo {
	url: string;
	has_custom_certificate: boolean;
	pending_update_count: number;
	ip_address?: string;
	last_error_date?: number;
	last_error_message?: string;
	last_synchronization_error_date?: number;
	max_connections?: number;
	allowed_updates?: string[];
}

// --- Core Functions ---

/**
 * A generic helper for making requests to the Telegram Bot API.
 * @param method The API method to call (e.g., 'getMe', 'sendMessage').
 * @param token The bot token.
 * @param payload An optional payload for POST requests.
 * @returns The 'result' field from the Telegram API response.
 * @throws Throws an error if the API request fails or the response is not 'ok'.
 */
async function telegramApi<T>(method: string, token: string, payload?: object): Promise<T> {
	const url = `https://api.telegram.org/bot${token}/${method}`;
	const options: RequestInit = {
		method: payload ? 'POST' : 'GET',
		headers: { 'Content-Type': 'application/json' },
		body: payload ? JSON.stringify(payload) : undefined,
	};

	const res = await fetch(url, options);
	if (!res.ok) {
		const errorData = await res.json().catch(() => ({ description: 'Failed to parse error response' }));
		throw new Error(`Telegram API error (${res.status}): ${errorData.description}`);
	}

	const data = await res.json();
	if (!data.ok) {
		throw new Error(`Telegram API error: ${data.description}`);
	}
	return data.result;
}

/**
 * Get file information from Telegram.
 * @param fileId The file_id of the file to get info for.
 * @param env The environment variables.
 * @returns A promise that resolves to the file information.
 */
async function getFileInfo(fileId: string, env: Env): Promise<File> {
	console.log(`Getting file info for ID: ${fileId}`);
	const result = await telegramApi<File>('getFile', env.BOT_TOKEN, { file_id: fileId });
	console.log('File info response:', result);
	return result;
}

/**
 * Securely check if the webhook request is authorized by validating the secret token.
 * @param request The incoming request.
 * @param env The environment variables.
 * @returns A promise that resolves to true if the request is authorized, false otherwise.
 */
async function checkWebhookAuth(request: Request, env: Env): Promise<boolean> {
	const secretToken = env.SECRET_TOKEN || '';
	if (!secretToken) {
		console.warn('🔒 No SECRET_TOKEN configured. Webhook requests are not being authenticated. This is NOT recommended for production.');
		return true; // For ease of setup, allow if not set.
	}

	const token = request.headers.get('X-Telegram-Bot-API-Secret-Token');
	if (token === secretToken) {
		console.log('✅ Webhook request authenticated');
		return true;
	}

	console.error('🔒 Webhook request unauthorized, missing or wrong token. Ensure SECRET_TOKEN is set correctly on both Telegram and the worker.');
	return false;
}

// --- Request Handlers ---

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
async function handleFileProxy(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
	const { file_id } = params;
	if (!file_id) {
		// This case should not be reached if the router is working correctly
		return new Response(JSON.stringify({ status: 'error', message: 'File ID is missing.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
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
			return new Response(
				JSON.stringify(
					{
						status: 'success',
						file_info: {
							...file_info,
							download_url: file_url,
						},
					},
					null,
					2
				),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} else {
			console.log(`Redirecting to: ${file_url}`);
			return Response.redirect(file_url, 302);
		}
	} catch (error: any) {
		console.error(`🚫 Failed to proxy file:`, error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		return new Response(JSON.stringify({ status: 'error', message: `Proxy failed: ${errorMessage}` }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
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
async function handleWebhook(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
	console.log('📦 Webhook request received');

	if (!(await checkWebhookAuth(request, env))) {
		return new Response(JSON.stringify({ status: 'error', message: 'Unauthorized webhook request' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const body = await request.json<Update>();
		if (!body || !body.message) {
			console.warn('🟠 Webhook update does not contain a message.');
			return new Response(JSON.stringify({ status: 'ok', message: 'Update received, but no message to process.' }));
		}

		const message = body.message;
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

你也可以通过浏览器访问以下管理端点：
- \`/setWebhook\`：设置 Webhook
- \`/deleteWebhook\`：删除 Webhook
- \`/info\`：获取 Webhook 信息
- \`/debug\`：查看 Worker 状态`;
			await sendMessage(message.chat.id, helpText, env, 'Markdown');
		}

		return new Response(JSON.stringify({ status: 'success' }));
	} catch (error: any) {
		console.error('🚨 Error processing webhook:', error.message);
		return new Response(JSON.stringify({ status: 'error', message: 'Internal error processing webhook.' }));
	}
}

/**
 * Sets the webhook for the Telegram bot to point to this worker.
 * @param request The incoming request.
 * @param env The environment variables.
 * @param params The route parameters (unused in this handler).
 * @returns A Response indicating success or failure.
 */
async function setWebhook(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
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
		return new Response(JSON.stringify({ status: 'success', message }));
	} catch (error: any) {
		console.error(`🚫 Failed to set webhook: ${error.message}`);
		return new Response(JSON.stringify({ status: 'error', message: error.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Deletes the webhook for the Telegram bot.
 * @param request The incoming request.
 * @param env The environment variables.
 * @param params The route parameters (unused in this handler).
 * @returns A Response indicating success or failure.
 */
async function deleteWebhook(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
	console.log('🔄 Deleting Telegram webhook...');
	try {
		await telegramApi<boolean>('setWebhook', env.BOT_TOKEN, { url: '' });
		console.log('✅ Webhook deleted successfully.');
		return new Response(JSON.stringify({ status: 'success', message: 'Webhook deleted successfully.' }));
	} catch (error: any) {
		console.error(`🚫 Failed to delete webhook: ${error.message}`);
		return new Response(JSON.stringify({ status: 'error', message: error.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Gets information about the current webhook.
 * @param request The incoming request.
 * @param env The environment variables.
 * @param params The route parameters (unused in this handler).
 * @returns A Response with the webhook information.
 */
async function getWebhookInfo(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
	console.log('🔍 Querying webhook info...');
	try {
		const info = await telegramApi<WebhookInfo>('getWebhookInfo', env.BOT_TOKEN);
		console.log('ℹ️ Webhook info:', info);
		return new Response(JSON.stringify({ status: 'success', webhook_info: info }));
	} catch (error: any) {
		console.error(`🚫 Failed to get webhook info: ${error.message}`);
		return new Response(JSON.stringify({ status: 'error', message: error.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Sends a message to a Telegram chat.
 * @param chatId The ID of the chat to send the message to.
 * @param text The text of the message.
 * @param env The environment variables.
 * @param parseMode The parse mode for the message (e.g., 'Markdown').
 */
async function sendMessage(chatId: string | number, text: string, env: Env, parseMode: string = 'Markdown') {
	console.log(`📲 Sending message to chat: ${chatId}`);
	try {
		await telegramApi<Message>('sendMessage', env.BOT_TOKEN, {
			chat_id: chatId,
			text: text,
			parse_mode: parseMode,
		});
		console.log('💬 Message sent successfully.');
	} catch (error: any) {
		console.error(`🚫 Failed to send message: ${error.message}`);
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
async function debugEnv(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
	const worker_host = env.WORKER_URL || new URL(request.url).host;
	return new Response(
		JSON.stringify(
			{
				status: 'success',
				message: 'Telegram File Proxy Worker is running.',
				env: {
					bot_token: env.BOT_TOKEN ? '[REDACTED]' : 'Not Set',
					secret_token: env.SECRET_TOKEN ? '[REDACTED]' : 'Not Set',
					worker_url: env.WORKER_URL || `Not Set (using request host: ${worker_host})`,
				},
			},
			null,
			2
		),
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
}

// --- Main Fetch Handler ---

type RouteHandler = (request: Request, env: Env, params: Record<string, string>) => Promise<Response>;

const routes: [string, RegExp, RouteHandler][] = [
	['POST', /^\/webhook\/?$/, handleWebhook],
	['GET', /^\/file\/(?<file_id>[^/]+)\/?$/, handleFileProxy],
	['GET', /^\/setWebhook\/?$/, setWebhook],
	['GET', /^\/deleteWebhook\/?$/, deleteWebhook],
	['GET', /^\/(info|getWebhookInfo)\/?$/, getWebhookInfo],
	['GET', /^\/debug\/?$/, debugEnv],
];

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (!env.BOT_TOKEN) {
			const errorMsg = 'CRITICAL: BOT_TOKEN environment variable is not set.';
			console.error(errorMsg);
			return new Response(JSON.stringify({ status: 'error', message: `Configuration error: ${errorMsg}` }), {
				status: 500,
				headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
			});
		}

		const url = new URL(request.url);
		const method = request.method;
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Telegram-Bot-API-Secret-Token',
		};

		if (method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		const addCors = (response: Response) => {
			Object.entries(corsHeaders).forEach(([key, value]) => response.headers.set(key, value));
			return response;
		};

		let response: Response;
		try {
			for (const [routeMethod, pattern, handler] of routes) {
				if (method === routeMethod) {
					const match = url.pathname.match(pattern);
					if (match) {
						const params = match.groups || {};
						response = await handler(request, env, params);
						return addCors(response);
					}
				}
			}

			// Default response for unmatched routes
			response = new Response(
				JSON.stringify({
					status: 'success',
					message: 'Telegram File Proxy Worker is running. See /debug for status.',
				}),
				{ headers: { 'Content-Type': 'application/json' } }
			);
		} catch (e: any) {
			console.error('🚨 Unhandled error in fetch:', e);
			const errorMessage = e instanceof Error ? e.message : String(e);
			response = new Response(JSON.stringify({ status: 'error', message: `Unhandled error: ${errorMessage}` }), { status: 500 });
		}

		return addCors(response);
	},
};
