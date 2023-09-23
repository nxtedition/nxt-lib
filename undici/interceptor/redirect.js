const { RedirectHandler } = require('undici')

module.exports = (dispatch) => (opts, handler) =>
  opts.follow
    ? dispatch(opts, new RedirectHandler(dispatch, opts.follow.count ?? 8, opts, handler))
    : dispatch(opts, handler)
