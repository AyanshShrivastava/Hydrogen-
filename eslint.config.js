import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', '.workbench-data/**/*', 'workspace/**/*'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
