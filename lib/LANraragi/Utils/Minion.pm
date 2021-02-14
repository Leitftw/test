package LANraragi::Utils::Minion;

use strict;
use warnings;

use Encode;
use Mojo::UserAgent;

use LANraragi::Utils::Logging qw(get_logger);
use LANraragi::Utils::Database qw(redis_decode);
use LANraragi::Utils::Archive qw(extract_thumbnail);
use LANraragi::Utils::Plugins qw(get_downloader_for_url get_plugin get_plugin_parameters);

use LANraragi::Model::Upload;

# Add Tasks to the Minion instance.
sub add_tasks {
    my $minion = shift;

    $minion->add_task(
        thumbnail_task => sub {
            my ( $job,     @args ) = @_;
            my ( $dirname, $id )   = @args;

            my $thumbname = extract_thumbnail( $dirname, $id );
            $job->finish($thumbname);
        }
    );

    $minion->add_task(
        warm_cache => sub {
            my ( $job, @args ) = @_;
            my $logger = get_logger( "Minion", "minion" );

            $logger->info("Warming up search cache...");

            # Cache warm performs a search for the base index (no search)
            LANraragi::Model::Search::do_search( "", "", 0, "title", "asc", 0, 0 );

            # And for every category defined by the user.
            my @categories = LANraragi::Model::Category->get_category_list;
            for my $category (@categories) {
                my $catid = %{$category}{"id"};
                $logger->debug("Warming category $catid");
                LANraragi::Model::Search::do_search( "", $catid, 0, "title", "asc", 0, 0 );
            }

            $logger->info("Done!");
            $job->finish;
        }
    );

    $minion->add_task(
        handle_upload => sub {
            my ( $job,  @args )  = @_;
            my ( $file, $catid ) = @args;

            my $logger = get_logger( "Minion", "minion" );
            $logger->info("处理上传的文件 $file...");

# Superjank warning for the code below.
#
# Filepaths are left unencoded across all of LRR to avoid any headaches with how the filesystem handles filenames with non-ASCII characters.
# (Some FS do UTF-8 properly, others not at all. We use File::Find, which returns direct bytes, to always have a filepath that matches the FS.)
#
# By "unencoded" tho, I actually mean Latin-1/ISO-8859-1.
# Perl strings are internally either in Latin-1 or non-strict utf-8 ("utf8"), depending on the history of the string.
# (See https://perldoc.perl.org/perlunifaq#I-lost-track;-what-encoding-is-the-internal-format-really?)
#
# When passing the string through the Minion pipe, it gets switched to utf8 for...reasons? ¯\_(ツ)_/¯
# This actually breaks the string and makes it no longer match the real name/byte sequence if it contained non-ASCII characters,
# so we use this arcane dark magic function to switch it back.
# (See https://perldoc.perl.org/perlunicode#Forcing-Unicode-in-Perl-(Or-Unforcing-Unicode-in-Perl))
            utf8::downgrade( $file, 1 )
              or die "Bullshit! File path could not be converted back to a byte sequence!"
              ;    # This error happening would not make any sense at all so it deserves the EYE reference

            # Since we already have a file, this goes straight to handle_incoming_file.
            my ( $status, $id, $title, $message ) = LANraragi::Model::Upload::handle_incoming_file( $file, $catid, "" );

            $job->finish(
                {   success  => $status,
                    id       => $id,
                    category => $catid,
                    title    => redis_decode($title),    # We use a decode here to fix display issues in the response.
                    message  => $message
                }
            );
        }
    );

    $minion->add_task(
        download_url => sub {
            my ( $job, @args )  = @_;
            my ( $url, $catid ) = @args;

            my $og_url = $url;                               # Keep a clean copy of the url for final response
            my $ua     = Mojo::UserAgent->new;
            my $logger = get_logger( "Minion", "minion" );
            $logger->info("下载 url $url...");

            # Check downloader plugins for one matching the given URL
            my $downloader = get_downloader_for_url($url);

            if ($downloader) {

                $logger->info( "发现下载器" . $downloader->{namespace} );

                # Use the downloader to transform the URL
                my $plugname = $downloader->{namespace};
                my $plugin   = get_plugin($plugname);
                my @settings = get_plugin_parameters($plugname);

                my $plugin_result = LANraragi::Model::Plugins::exec_download_plugin( $plugin, $url, @settings );

                if ( exists $plugin_result->{error} ) {
                    $job->finish(
                        {   success => 0,
                            url     => $url,
                            message => $plugin_result->{error}
                        }
                    );
                }

                $ua  = $plugin_result->{user_agent};
                $url = $plugin_result->{download_url};
                $logger->info("URL transformed by plugin to $url");
            } else {
                $logger->debug("找不到下载程序，尝试直接下载 URL.");
            }

            # Download the URL
            eval {
                my $tempfile = LANraragi::Model::Upload::download_url( $url, $ua );
                $logger->info("链接已下载到 $tempfile");

                # Add the url as a source: tag
                my $tag = "";

                # Strip http(s)://www. from the url before adding it to tags
                if ( $og_url =~ /https?:\/\/(.*)/gm ) {
                    $tag = "source:$1";
                }

                # Hand off the result to handle_incoming_file
                my ( $status, $id, $title, $message ) = LANraragi::Model::Upload::handle_incoming_file( $tempfile, $catid, $tag );

                $job->finish(
                    {   success  => $status,
                        url      => $og_url,
                        id       => $id,
                        category => $catid,
                        title    => $title,
                        message  => $message
                    }
                );
            };

            if ($@) {

                # Downloading failed...
                $job->finish(
                    {   success => 0,
                        url     => $og_url,
                        message => $@
                    }
                );
            }
        }
    );
}

1;
