<script lang="ts">
	import type { CellData } from '$lib/commitLines/types';

	interface Props {
		cell: CellData;
		isBottom?: boolean;
	}

	const { cell, isBottom = false }: Props = $props();
</script>

<div
	class="commit-line stacked"
	class:local={cell.type === 'local'}
	class:remote={cell.type === 'localAndRemote'}
	class:local-shadow={cell.type === 'localAndShadow'}
	class:upstream={cell.type === 'remote'}
	class:integrated={cell.type === 'integrated'}
	class:dashed={isBottom}
></div>

<style lang="postcss">
	.commit-line {
		width: 2px;
		margin: 0 22px 0 20px;
	}
</style>
