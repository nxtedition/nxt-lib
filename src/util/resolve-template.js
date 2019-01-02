const balanced = require('balanced-match')

module.exports = async function resolveTemplate (template, context) {
  let response = ''
  const match = balanced('{{', '}}', template)
  if (!match) {
    return template
  }
  var { pre, body, post } = match
  response += pre
  response += getProperty(context, body)
  if (post) {
    response += await resolveTemplate(post, context)
  }
  return response
}

function getProperty (obj, desc) {
  var arr = desc.split('.')
  while (arr.length && (obj = obj[arr.shift()]));
  return obj
}
