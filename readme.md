# Pingbox

## install

  vue add electron-builder
  
  export npm_config_target=3.0.0
  export npm_config_arch=x64
  export npm_config_target_arch=x64
  export npm_config_disturl=https://atom.io/download/electron
  export npm_config_runtime=electron
  export npm_config_build_from_source=true
  HOME=~/.electron-gyp npm install

  export npm_config_build_from_source=fals
  npm install grpc@^1.18.0 --runtime=electron --target=3.0.0

  npm run electron:serve

