#!/bin/sh
EX="--exclude upstream/xpi/install.rdf --exclude=upstream/xpi/chrome/content/quickPostForm.xul"
exec tar -c $EX upstream/xpi/ | tar --strip-components=2 -xv
