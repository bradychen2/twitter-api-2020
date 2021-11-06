const apis = require('./apis')
const swaggerUi = require('swagger-ui-express')
const YAML = require('yamljs')
const swaggerDocument = YAML.load('swagger.yaml')

module.exports = (app) => {
  app.use('/api', apis)
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument))

  // 錯誤處理
  app.use((err, req, res, next) => {
    console.log(err)
    res.status(500).json({ error: '500 - Server Error' })
  })
}
