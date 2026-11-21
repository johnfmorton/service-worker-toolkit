import stylistic from '@stylistic/eslint-plugin'
import tseslint from 'typescript-eslint'

export default tseslint.config(
	{ ignores: ['dist/', 'coverage/', 'node_modules/'] },
	...tseslint.configs.strict,
	...tseslint.configs.stylistic,
	stylistic.configs.customize({
		indent: 'tab',
		quotes: 'single',
		semi: false,
		braceStyle: '1tbs',
		arrowParens: true,
	}),
	{
		rules: {
			// Short lists read better packed onto a line.
			'@stylistic/list-style': 'off',
		},
	},
	{
		// The exporter is pure too: a config in, a string out.
		files: ['src/export/**'],
		rules: {
			'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'fetch', 'self'],
			'no-restricted-imports': ['error', { patterns: ['workbox-*', '**/ui/**'] }],
		},
	},
	{
		// The engine must run in a page, a Web Worker, Node or CI alike:
		// no DOM, no storage, no network.
		files: ['src/engine/**'],
		rules: {
			'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'fetch', 'self'],
			'no-restricted-imports': ['error', { patterns: ['workbox-*', '**/ui/**', '**/export/**'] }],
		},
	},
)
