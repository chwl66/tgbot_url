import { Env, RouteHandler } from './types';
import { handleWebhook, handleFileProxy, setWebhook, deleteWebhook, getWebhookInfo, debugEnv } from './handlers';
import { jsonResponse } from './utils';

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
			return jsonResponse({ status: 'error', message: `Configuration error: ${errorMsg}` }, 500);
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

		const addCors = (response: Response): Response => {
			const newResponse = new Response(response.body, response);
			Object.entries(corsHeaders).forEach(([key, value]) => {
				newResponse.headers.set(key, value);
			});
			return newResponse;
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

			response = jsonResponse({
				status: 'success',
				message: 'Telegram File Proxy Worker is running. See /debug for status.',
			});
		} catch (e: unknown) {
			console.error('🚨 Unhandled error in fetch:', e);
			const errorMessage = e instanceof Error ? e.message : String(e);
			response = jsonResponse({ status: 'error', message: `Unhandled error: ${errorMessage}` }, 500);
		}

		return addCors(response);
	},
};
