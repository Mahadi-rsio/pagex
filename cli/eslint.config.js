// @ts-check
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                project: "./tsconfig.json",
                sourceType: "module",
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
        },
        rules: {
            ...tseslint.configs["recommended"].rules,
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
            "@typescript-eslint/explicit-function-return-type": "off",
            "no-console": "off",
        },
    },
    {
        ignores: ["dist/**", "node_modules/**"],
    },
];
