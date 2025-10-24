export interface Env {
	BOT_TOKEN: string;
	SECRET_TOKEN: string;
	WORKER_URL?: string;
}

export interface User {
	id: number;
	is_bot: boolean;
	first_name: string;
	last_name?: string;
	username?: string;
}

export interface Chat {
	id: number;
	type: 'private' | 'group' | 'supergroup' | 'channel';
	title?: string;
	username?: string;
}

export interface PhotoSize {
	file_id: string;
	file_unique_id: string;
	width: number;
	height: number;
	file_size?: number;
}

export interface Document {
	file_id: string;
	file_unique_id: string;
	file_name?: string;
	mime_type?: string;
	file_size?: number;
}

export interface Video {
	file_id: string;
	file_unique_id: string;
	width: number;
	height: number;
	duration: number;
	file_name?: string;
	mime_type?: string;
	file_size?: number;
}

export interface Audio {
	file_id: string;
	file_unique_id: string;
	duration: number;
	file_name?: string;
	mime_type?: string;
	file_size?: number;
}

export interface Voice {
	file_id: string;
	file_unique_id: string;
	duration: number;
	mime_type?: string;
	file_size?: number;
}

export interface Message {
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

export interface Update {
	update_id: number;
	message?: Message;
}

export interface File {
	file_id: string;
	file_unique_id: string;
	file_size?: number;
	file_path?: string;
}

export interface WebhookInfo {
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

export type RouteHandler = (request: Request, env: Env, params: Record<string, string>) => Promise<Response>;
