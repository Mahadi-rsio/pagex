// Configuration loaders for different formats

import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { parse } from 'yaml';
import type { AppConfig, DatabaseConfig, RedisConfig, StorageConfig } from './schemas';

/**
 * Load configuration from JSON file
 */
export async function loadJsonConfig<T>(path: string): Promise<T> {
  const content = await fs.readFile(path, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * Load configuration from YAML file
 */
export async function loadYamlConfig<T>(path: string): Promise<T> {
  const content = await fs.readFile(path, 'utf-8');
  return parse(content) as T;
}

/**
 * Load configuration from environment file
 */
export async function loadEnvConfig(path: string): Promise<Record<string, string>> {
  const content = await fs.readFile(path, 'utf-8');
  const config: Record<string, string> = {};
  
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, value] = trimmed.split('=', 2);
      if (key && value !== undefined) {
        config[key.trim()] = value.replace(/^['"]|['"]$/g, '').trim();
      }
    }
  });
  
  return config;
}

/**
 * Load database configuration from file
 */
export async function loadDatabaseConfig(path: string): Promise<DatabaseConfig> {
  try {
    const content = await fs.readFile(path, 'utf-8');
    const config = JSON.parse(content) as DatabaseConfig;
    return {
      host: config.host || 'localhost',
      port: config.port || 5432,
      user: config.user || 'postgres',
      password: config.password || 'postgres',
      database: config.database || 'pagex',
      ssl: config.ssl || false,
    };
  } catch {
    // Return default configuration
    return {
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'pagex',
      ssl: false,
    };
  }
}

/**
 * Load Redis configuration from file
 */
export async function loadRedisConfig(path: string): Promise<RedisConfig> {
  try {
    const content = await fs.readFile(path, 'utf-8');
    const config = JSON.parse(content) as RedisConfig;
    return {
      url: config.url,
      host: config.host || 'localhost',
      port: config.port || 6379,
      password: config.password,
      db: config.db || 0,
    };
  } catch {
    // Return default configuration
    return {
      host: 'localhost',
      port: 6379,
      db: 0,
    };
  }
}

/**
 * Load storage configuration from file
 */
export async function loadStorageConfig(path: string): Promise<StorageConfig> {
  try {
    const content = await fs.readFile(path, 'utf-8');
    const config = JSON.parse(content) as StorageConfig;
    return {
      endpoint: config.endpoint || 'localhost',
      port: config.port || 9000,
      useSSL: config.useSSL || false,
      accessKey: config.accessKey || '',
      secretKey: config.secretKey || '',
      bucket: config.bucket || 'pagex-blobs',
    };
  } catch {
    // Return default configuration
    return {
      endpoint: 'localhost',
      port: 9000,
      useSSL: false,
      accessKey: '',
      secretKey: '',
      bucket: 'pagex-blobs',
    };
  }
}

/**
 * Load full application configuration
 */
export async function loadAppConfig(configPath?: string): Promise<AppConfig> {
  const basePath = configPath || join(process.cwd(), 'config');
  
  try {
    // Try to load from JSON file
    const jsonPath = join(basePath, 'app.json');
    const config = await loadJsonConfig<AppConfig>(jsonPath);
    return config;
  } catch {
    // Try to load from YAML file
    try {
      const yamlPath = join(basePath, 'app.yaml');
      const config = await loadYamlConfig<AppConfig>(yamlPath);
      return config;
    } catch {
      // Return default configuration
      const { createConfig } = await import('./schemas');
      return createConfig({
        db: {
          host: 'localhost',
          port: 5432,
          user: 'postgres',
          password: 'postgres',
          database: 'pagex',
          ssl: false,
        },
        redis: {
          host: 'localhost',
          port: 6379,
          db: 0,
        },
        storage: {
          endpoint: 'localhost',
          port: 9000,
          useSSL: false,
          accessKey: '',
          secretKey: '',
          bucket: 'pagex-blobs',
        },
        baseDomain: 'localhost',
        environment: 'development',
        debug: false,
      });
    }
  }
}

/**
 * Save configuration to JSON file
 */
export async function saveJsonConfig<T>(path: string, config: T): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(config, null, 2));
}

/**
 * Save configuration to YAML file
 */
export async function saveYamlConfig<T>(path: string, config: T): Promise<void> {
  const yaml = require('yaml');
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, yaml.stringify(config));
}

/**
 * Watch configuration file for changes
 */
export async function watchConfigFile<T>(
  path: string,
  callback: (config: T) => void,
  initialLoad: boolean = true
): Promise<() => void> {
  const { watch } = await import('node:fs');
  
  // Initial load
  if (initialLoad) {
    try {
      const config = await loadJsonConfig<T>(path);
      callback(config);
    } catch {
      // Ignore initial load errors
    }
  }
  
  // Watch for changes
  const watcher = watch(path, async (eventType) => {
    if (eventType === 'change') {
      try {
        const config = await loadJsonConfig<T>(path);
        callback(config);
      } catch {
        // Ignore parse errors
      }
    }
  });
  
  // Return cleanup function
  return () => watcher.close();
}
