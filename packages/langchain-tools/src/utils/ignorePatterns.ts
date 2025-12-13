/**
 * Default ignore patterns for file system operations
 */

// Common directories and files to ignore
export const DEFAULT_IGNORE_PATTERNS = [
    // Dependencies
    'node_modules',
    'bower_components',
    'vendor',
    'packages',
    
    // Build outputs
    'dist',
    'build',
    'out',
    '.next',
    '.nuxt',
    '.output',
    'target',
    'bin',
    'obj',
    
    // Cache and temp
    '.cache',
    '.temp',
    '.tmp',
    'tmp',
    'temp',
    
    // Version control
    '.git',
    '.svn',
    '.hg',
    
    // IDE and editor
    '.vscode',
    '.idea',
    '.vs',
    '*.swp',
    '*.swo',
    '*~',
    
    // Coverage and test artifacts
    'coverage',
    '.nyc_output',
    'test-results',
    
    // Logs
    '*.log',
    'logs',
    
    // OS files
    '.DS_Store',
    'Thumbs.db',
    'desktop.ini',
    
    // Lock files
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'Gemfile.lock',
    'Cargo.lock',
];

/**
 * Convert a glob pattern to a regex pattern
 */
function globToRegex(pattern: string): RegExp {
    // Escape special regex characters except * and ?
    let regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    
    // If pattern doesn't start with *, match from start
    if (!pattern.startsWith('*')) {
        regexPattern = '^' + regexPattern;
    }
    
    // If pattern doesn't end with *, match to end
    if (!pattern.endsWith('*')) {
        regexPattern = regexPattern + '$';
    }
    
    return new RegExp(regexPattern);
}

/**
 * Check if a file path should be ignored based on patterns
 * @param filePath - The file path to check (can be absolute or relative)
 * @param customIgnorePatterns - Additional ignore patterns to merge with defaults
 * @returns true if the file should be ignored
 */
export function shouldIgnore(
    filePath: string,
    customIgnorePatterns: string[] = []
): boolean {
    const allPatterns = [...DEFAULT_IGNORE_PATTERNS, ...customIgnorePatterns];
    
    // Extract just the filename and path components
    const pathParts = filePath.split('/');
    
    for (const pattern of allPatterns) {
        const regex = globToRegex(pattern);
        
        // Check if any part of the path matches the pattern
        for (const part of pathParts) {
            if (regex.test(part)) {
                return true;
            }
        }
        
        // Also check the full path
        if (regex.test(filePath)) {
            return true;
        }
    }
    
    return false;
}

