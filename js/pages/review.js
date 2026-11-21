// Review used to be a separate page. It is now part of Study, so old links and bookmarks land there.
import { navigate } from '../lib/ui.js';

export default {
  render() { navigate('study'); }
};
