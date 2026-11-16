/** @format */

import { EventBuilder } from '@xernerx/framework';
import type { Interaction } from 'discord.js';

export default class AutocompleteInteractionEvent extends EventBuilder {
	constructor() {
		super('autocompleteInteraction', {
			name: 'interactionCreate',
			emitter: 'client',
			once: false,
		});
	}

	override async run(interaction: Interaction) {
		if (!interaction.isAutocomplete()) return;
		const command = this.client.commands.slash.get(interaction.commandName);
		if (!command || typeof command.autocomplete !== 'function') return;

		try {
			const focused = interaction.options.getFocused(true);
			await command.autocomplete({
				interaction: interaction as any,
				focused,
				options: interaction.options as any,
			});
		} catch {
			if (!interaction.responded) {
				await interaction.respond([]).catch(() => null);
			}
		}
	}
}
