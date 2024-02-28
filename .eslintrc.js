const stylistic = require("@stylistic/eslint-plugin");

/**
 * The new *ESLint Stylistic* package has some new approach to sharable configs (the stuff you used to extend,
 * eg. `{extends:["airbnb"]}` ) where you [use a factory method](https://eslint.style/guide/config-presets#configuration-factory)
 * to create an object which you then expand in the `rules` section instead of mentioning it in `extends`.
 *
 * It seems not all rules can be customized in this factory though, it's more about customizing the defaults
 * slightly. Those defaults and all available customization which can be passed to this function is currently
 * (2024-02-28) only available in the [source code on github](https://github.com/eslint-stylistic/eslint-stylistic/blob/main/packages/eslint-plugin/configs/customize.ts)
 */
const defaults = stylistic.configs.customize({
	indent: "tab"
	, quotes: "double"
	, semi: true
	, jsx: false
	, flat: false,
});

/**
 * Any additional rules are listed here and also expanded in the `rules` section below.
 *
 * See [the online docs](https://eslint.style/packages/default#rules) for a complete list of available rules and
 * their options
 */
const myRules = {
	"@stylistic/linebreak-style": ["error", "unix"]
	, "@stylistic/no-unused-vars": "off"
	, "@stylistic/comma-spacing": ["error", { before: false, after: true }]
	, "@stylistic/comma-style": ["error", "first"]
	, "@stylistic/comma-dangle": ["error", "only-multiline"]
	, "@stylistic/max-statements-per-line": "off"
};

module.exports = {
	env: {
		es2021: true
		, node: true,
	}
	, parser: "@typescript-eslint/parser"
	, parserOptions: {
		ecmaVersion: 12
		, sourceType: "module"
	}
	, plugins: [
		"@stylistic"
	]
	, rules: {
		...defaults.rules
		, ...myRules,
	},
};
