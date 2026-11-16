/** @format */

import { EventBuilder } from '@xernerx/framework';
import type { Guild } from 'discord.js';
import { createGuildProfile } from '../lib/guildSync.js';

export default class GuildCreateEvent extends EventBuilder {
	constructor() {
		super('guildCreate', {
			name: 'guildCreate',
			emitter: 'client',
			once: false,
		});
	}

	override async run(guild: Guild) {
		if (!guild?.id) return;
		const ws = (this.client as any).websocket;
		await createGuildProfile(ws, guild);
	}
}
