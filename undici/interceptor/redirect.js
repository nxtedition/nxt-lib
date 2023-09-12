const { RedirectHandler } = require('undici')

module.exports = (dispatch) => (opts, handler) =>
  opts.redirect?.count > 0
    ? dispatch(opts, new RedirectHandler(dispatch, opts.redirect.count, opts, handler))
    : dispatch(opts, handler)
