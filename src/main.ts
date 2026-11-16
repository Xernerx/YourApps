/** @format */

import fs from 'node:fs';
import { XernerxCommands } from '@xernerx/commands';
import { XernerxClient } from '@xernerx/framework';
import { XernerxHooks } from '@xernerx/hooks';
import { XernerxStats } from '@xernerx/stats';
import { XernerxWebsocket } from '@xernerx/websocket';
import { getApiUrl, getWsUrl, isProductionTarget } from './lib/endpoints.js';

// Pin API_URL for @xernerx/framework internal engagement requests (dev in DEVELOPMENT, prod on CANARY + PRODUCTION)
process.env.API_URL = getApiUrl();

function restoreDocumentId<T>(res: T, fallbackId?: unknown): T {
	if (!res || typeof res !== 'object' || Array.isArray(res)) return res;
	const obj = res as Record<string, any>;
	if (obj.id === undefined) {
		if (typeof obj.docId === 'string') {
			obj.id = obj.docId;
		} else if ('_id' in obj && typeof fallbackId === 'string' && fallbackId) {
			obj.id = fallbackId;
		}
	}
	return res;
}

export class WebSocket extends XernerxWebsocket {
	constructor() {
		super({
			token: (process.env.WS_TOKEN || process.env.API_TOKEN || '').trim(),
			url: getWsUrl(),
		});
	}

	override async connect() {
		const rawWs = (this as any).ws;
		if (rawWs && rawWs.readyState !== 1 && rawWs.readyState !== 0) {
			(this as any).ready = false;
			(this as any).connecting = null;
		}
		if ((this as any).ready && rawWs?.readyState === 1) {
			return;
		}
		return super.connect();
	}

	override async get<T = any>(service: string, action: string, body: Record<string, any> = {}): Promise<T> {
		const res = await super.get<T>(service, action, body);
		if (res && typeof res === 'object' && !Array.isArray(res) && Object.keys(res as Record<string, unknown>).length === 0) {
			return null as T;
		}
		return restoreDocumentId(res, body?.id);
	}

	override async create<T = any>(service: string, action: string, body: Record<string, any> = {}): Promise<T> {
		const res = await super.create<T>(service, action, body);
		return restoreDocumentId(res, body?.id);
	}

	override async update<T = any>(service: string, action: string, body: Record<string, any> = {}): Promise<T> {
		const res = await super.update<T>(service, action, body);
		return restoreDocumentId(res, body?.id);
	}
}

export const websocket = new WebSocket();

export class Client extends XernerxClient {
	declare public websocket: WebSocket;
	declare public hooks?: XernerxHooks;

	constructor() {
		// Strictly no MessageContent intent — 100% Slash Commands, Context Menus, Buttons, Select Menus, & Modals
		super({
			intents: ['Guilds', 'GuildMessages'],
			token: process.env.TOKEN as string,
			guildId: process.env.GUILD_ID || '784094726432489522',
			owners: process.env.OWNER_ID || '482513687417061376',
			global: isProductionTarget(),
		});

		fs.mkdirSync('dist/events', { recursive: true });
		fs.mkdirSync('dist/commands/slash', { recursive: true });
		fs.mkdirSync('dist/commands/context', { recursive: true });

		this.modules.eventHandler.loadEvents({
			directory: 'dist/events',
		});

		this.modules.commandHandler.loadSlashCommands({
			directory: 'dist/commands/slash',
		});

		this.modules.commandHandler.loadContextCommands({
			directory: 'dist/commands/context',
		});

		const apiToken = (process.env.API_TOKEN || '').trim();
		const apiUrl = getApiUrl();
		const isPrimaryCluster = !this.sharded || this.cluster?.id === 0;

		const extensions: any[] = [
			new XernerxCommands(this, {
				token: apiToken,
				url: apiUrl,
			}),
		];

		// When sharded, XernerxStats runs on the parent XernerxShardClient in src/shard.ts
		if (!this.sharded) {
			extensions.push(
				new XernerxStats(this, {
					token: apiToken,
					url: apiUrl,
				})
			);
		}

		if (process.env.WEBHOOK_SECRET?.trim()) {
			const hooksExt = new XernerxHooks(this, {
				secret: process.env.WEBHOOK_SECRET.trim(),
				port: Number(process.env.WEBHOOK_PORT || 8080),
				token: apiToken || undefined,
				url: apiUrl,
				autoStart: isPrimaryCluster,
			});
			this.hooks = hooksExt;
			extensions.push(hooksExt);
		}

		this.modules.extensionHandler.loadExtensions(...extensions);

		this.websocket = websocket;
		this.websocket.connect().catch(() => null);

		this.connect();
	}
}

export const client = new Client();
