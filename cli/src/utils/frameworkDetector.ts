import fs from "fs";
import path from "path";
import { logger } from "./logger.js";

export type FrameworkCategory = 'Frontend' | 'Backend' | 'Fullstack' | 'Other';

export interface Framework {
    name: string;
    key: string;       // npm package or unique identifier
    category: FrameworkCategory;
}

/**
 * Detect frameworks in a project folder
 * @param projectPath - Path to the project
 * @returns Detected frameworks categorized
 */
export async function detectFramework(projectPath: string): Promise<Record<FrameworkCategory, string[]>> {
    const spinner = logger.spinner("Detecting frameworks...").start();

    const pkgPath = path.join(projectPath, 'package.json');
    let deps: Record<string, string> = {};

    try {
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            deps = { ...pkg.dependencies, ...pkg.devDependencies };
        }

        const frameworks: Framework[] = [
            // Backend
            { name: 'Express', key: 'express', category: 'Backend' },
            { name: 'Hono', key: 'hono', category: 'Backend' },
            { name: 'Fastify', key: 'fastify', category: 'Backend' },
            { name: 'NestJS', key: '@nestjs/core', category: 'Backend' },
            { name: 'Koa', key: 'koa', category: 'Backend' },

            // Frontend
            { name: 'React', key: 'react', category: 'Frontend' },
            { name: 'Vue', key: 'vue', category: 'Frontend' },
            { name: 'Angular', key: '@angular/core', category: 'Frontend' },
            { name: 'Svelte', key: 'svelte', category: 'Frontend' },

            // Fullstack
            { name: 'Next.js', key: 'next', category: 'Fullstack' },
            { name: 'Nuxt', key: 'nuxt', category: 'Fullstack' },
            { name: 'SvelteKit', key: '@sveltejs/kit', category: 'Fullstack' },

            // Other
            { name: 'Vite', key: 'vite', category: 'Other' },
        ];

        const detected: Record<FrameworkCategory, string[]> = {
            Frontend: [],
            Backend: [],
            Fullstack: [],
            Other: [],
        };

        frameworks.forEach(f => {
            if (deps[f.key]) {
                detected[f.category].push(f.name);
            }
        });

        // Python detection
        if (
            fs.existsSync(path.join(projectPath, 'requirements.txt')) ||
            fs.existsSync(path.join(projectPath, 'pyproject.toml'))
        ) {
            detected.Other.push('Python Project');
        }

        spinner.succeed("Framework detection complete!");

        // Log only categories with detected frameworks
        Object.entries(detected).forEach(([category, list]) => {
            if (list.length > 0) {
                logger.info(`${category}: ${list[0]}`);
            }
        });

        return detected;

    } catch (err) {
        spinner.fail("Error detecting frameworks");
        logger.error(String(err));
        return {
            Frontend: [],
            Backend: [],
            Fullstack: [],
            Other: [],
        };
    }
}
