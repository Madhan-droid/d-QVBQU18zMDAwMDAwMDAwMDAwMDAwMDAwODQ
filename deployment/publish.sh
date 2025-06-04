pnpm i
pnpm run build
 
cp package.json ./dist
cp -r lambda ./dist/
cp .npmrc ./dist
cp README.md ./dist
cp -r ./defaultData ./dist/defaultData
cp -r ./assets ./dist/assets
 
cd ./dist
 
pnpm run export