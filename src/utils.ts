import { Env, File, Message, WebhookInfo } from './types';

/**
 * A generic helper for making requests to the Telegram Bot API.
 * @param method The API method to call (e.g., 'getMe', 'sendMessage').
 * @param token The bot token.
 * @param payload An optional payload for POST requests.
 * @returns The 'result' field from the Telegram API response.
 * @throws Throws an error if the API request fails or the response is not 'ok'.
 */
export async function telegramApi<T>(method: string, token: string, payload?: object): Promise<T> {
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
export async function getFileInfo(fileId: string, env: Env): Promise<File> {
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
export async function checkWebhookAuth(request: Request, env: Env): Promise<boolean> {
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

/**
 * Sends a message to a Telegram chat.
 * @param chatId The ID of the chat to send the message to.
 * @param text The text of the message.
 * @param env The environment variables.
 * @param parseMode The parse mode for the message (e.g., 'Markdown').
 */
export async function sendMessage(chatId: string | number, text: string, env: Env, parseMode: string = 'Markdown') {
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
 * Creates a JSON response.
 * @param data The data to include in the response.
 * @param status The HTTP status code.
 * @returns A Response object.
 */
export function jsonResponse(data: object, status = 200): Response {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
