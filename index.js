module.exports = (app) => {
  const plugin = {
    id: 'posmv-input-plugin',
    name: 'PosMV Input Plugin',
    start: (settings, restartPlugin) => {
      // start up code goes here.
    },
    stop: () => {
      // shutdown code goes here.
    },
    schema: () => {
      properties: {
        // plugin configuration goes here
      }
    }
  }

  return plugin
}
