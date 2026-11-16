/** @format */

import { EventBuilder } from '@xernerx/framework';
import { Terminal } from '@xernerx/terminal';
import { ActivityType, type PresenceStatusData } from 'discord.js';
import { getAppUrl, getWsHealthUrl } from '../lib/endpoints.js';
import { syncGuildMetadata } from '../lib/guildSync.js';

export default class ClientReadyEvent extends EventBuilder {
	private readonly logger = new Terminal({ scope: 'READY', spin: false });
	private guildsSynced = false;
	private syncingGuilds = false;

	constructor() {
		super('clientReady', {
			name: 'clientReady',
			emitter: 'client',
			once: true,
		});
	}

	private async syncGuilds() {
		if (this.guildsSynced || this.syncingGuilds) return;
		const ws = (this.client as any).websocket;
		if (!ws) return;

		this.syncingGuilds = true;
		try {
			for (const [, guild] of this.client.guilds.cache) {
				await syncGuildMetadata(ws, guild, false).catch(() => null);
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			this.guildsSynced = true;
		} finally {
			this.syncingGuilds = false;
		}
	}

	override async run() {
		const client = this.client;
		const shardLabel = client.sharded ? ` (Cluster #${client.cluster?.id ?? 0})` : '';
		this.logger.info(`Logged in as ${client.user?.tag}${shardLabel}!`);

		const ws = (client as any).websocket;
		const healthUrl = getWsHealthUrl();
		const appUrl = getAppUrl();
		const isPrimaryCluster = !client.sharded || client.cluster?.id === 0;

		const heartbeat = async () => {
			const healthy = await fetch(healthUrl)
				.then((res) => res.ok)
				.catch(() => false);

			const connected = ws
				? await ws
						.connect()
						.then(() => true)
						.catch((err: unknown) => {
							if (healthy) {
								this.logger.warn(`Failed to connect to Xernerx WebSocket: ${(err as Error)?.message || err}`);
							}
							return false;
						})
				: false;

			const totalGuilds = client.stats?.guildCount || client.guilds.cache.size;

			const activity = {
				name: connected ? 'Server Applications' : 'Services Unavailable',
				type: connected ? ActivityType.Custom : ActivityType.Streaming,
				state: connected ? `Managing forms & applications | ${totalGuilds.toLocaleString()} servers` : 'Connection to the Xernerx WS has been lost, some features may not work as intended.',
				url: appUrl,
			};

			const status: PresenceStatusData = connected ? 'online' : 'dnd';

			if (connected) {
				void this.syncGuilds();
				if (isPrimaryCluster && client.user?.id) {
					await ws
						.update('xernerx', 'bots', {
							id: client.user.id,
							status,
							statusUpdatedAt: new Date(),
							activity: activity.state || activity.name,
						})
						.catch(() => null);
				}
			}

			client.user?.setPresence({
				status,
				activities: [activity],
			});

			setTimeout(heartbeat, 60_000);
		};

		await heartbeat();
	}
}
