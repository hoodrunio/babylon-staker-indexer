/**
 * Register module path aliases for use at runtime
 * This is needed because TypeScript path aliases are only resolved during compilation
 * but the compiled JavaScript still contains the alias imports
 */

import moduleAlias from 'module-alias';
import path from 'path';

// Add aliases
moduleAlias.addAliases({
  '@generated': path.resolve(process.cwd(), 'dist/generated'),
  '@protos': path.resolve(process.cwd(), 'dist/generated/proto')
});

